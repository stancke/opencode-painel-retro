import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { Index, createMemo, createSignal, onCleanup } from "solid-js"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { criarCena, MAX_PONTOS, quadroAguardando } from "./animacao"

/**
 * Painel OPENCODE + cena ASCII cyberpunk animada, exibidos ACIMA do prompt.
 *
 * Painel:
 *   linha 1 -> branch + estado do git (✚novos ~alterados -removidos)
 *   linha 2 -> pasta da sessão + uso do contexto + cronômetro/subagentes
 *   linha 3 -> (só quando acontece) aguardando permissão / pergunta / fila
 *
 * Estados da cena:
 *   - sessão trabalhando (`status === "running"`): robô cyberpunk andando
 *     da esquerda para a direita na chuva neon.
 *   - sessão parada: o quadro inteiro vira o banner ASCII
 *     "AGUARDANDO COMANDOS..." com os pontinhos piscando.
 *
 * Slot usado: `session.composer.top` (recebe `{ sessionID }`).
 *
 * Observação importante: o OpenCode injeta os módulos `@opencode/plugin/tui`,
 * `solid-js` e `@opentui/solid` em tempo de execução (module rewrite), então
 * este plugin NÃO precisa de node_modules próprio.
 */

/** Intervalo padrão entre quadros da animação (ms). */
const INTERVALO_PADRAO = 140

/** Período do pisca-pisca dos pontinhos, em ms. */
const PERIODO_PONTOS = 450

/** Intervalo padrão do `git status` (ms). */
const INTERVALO_GIT_PADRAO = 5000

/** Blocos da barra de contexto. */
const BLOCOS_CONTEXTO = 8

/** Configuração opcional lida de `config.json` dentro da pasta do plugin. */
type Config = {
  /** Quadro da animação em ms (60..1000). */
  fps?: number
  /** `false` desliga a cena e o banner. */
  animacao?: boolean
  /** Tamanho do banner de espera: 1 (padrão) ou 2 (dobrado). */
  escalaBanner?: number
  /** `false` esconde a barra de uso do contexto. */
  contexto?: boolean
  /** `false` esconde o status do git. */
  git?: boolean
  /** Intervalo do `git status` em ms (padrão 5000). */
  intervaloGit?: number
  /** `false` esconde o cronômetro e a contagem de subagentes. */
  cronometro?: boolean
  /** `false` esconde o aviso de permissão/pergunta/fila. */
  bloqueio?: boolean
}

/** Só o campo da sessão que este plugin usa. */
type SessaoComPasta = { location?: { directory?: string } }

/** Uso de tokens de uma mensagem (Token.Usage.Info). */
type UsoTokens = {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

/** Mensagem da sessão (só o que lemos). */
type MensagemSessao = {
  type?: string
  tokens?: UsoTokens
  time?: { created?: number }
}

/** Modelo disponível (só o que lemos). */
type ModeloInfo = {
  providerID?: string
  id?: string
  limit?: { context?: number }
}

/** Item da fila de entrada (Session.Inbox.*). */
type ItemInbox = {
  type?: string
  delivery?: string
  time?: { created?: number }
}

/** Pedido de permissão pendente. */
type PedidoPermissao = { action?: string; resources?: string[]; message?: string }

/** Formulário/pergunta pendente. */
type FormularioInfo = { title?: string }

/** Item de `git status` (Vcs.FileStatus). */
type ArquivoVcs = { status?: string }

/** Só o pedaço do client que este plugin usa. */
type ClienteVcs = {
  vcs?: {
    status?: (entrada: {
      location: { directory?: string }
    }) => Promise<{ data?: ArquivoVcs[] }>
  }
}

type ContextoDoPlugin = ReturnType<typeof usePlugin>

/** Corta textos longos pelo fim (para o branch). */
function encurtar(texto: string, limite: number): string {
  if (texto.length <= limite) return texto
  return texto.slice(0, limite - 1) + "…"
}

/** Corta caminhos longos pelo começo, preservando o fim (mais informativo). */
function encurtarInicio(texto: string, limite: number): string {
  if (texto.length <= limite) return texto
  return "…" + texto.slice(texto.length - limite + 1)
}

/** Duração curta: 42s / 3m12s / 1h05m. */
function formatarDuracao(segundos: number): string {
  if (segundos < 60) return segundos + "s"
  const minutos = Math.floor(segundos / 60)
  if (minutos < 60) {
    return minutos + "m" + String(segundos % 60).padStart(2, "0") + "s"
  }
  return Math.floor(minutos / 60) + "h" + String(minutos % 60).padStart(2, "0") + "m"
}

/** O modelo está trabalhando? (mesma regra usada pela sidebar do OpenCode) */
function estaTrabalhando(context: ContextoDoPlugin, sessionID: string): boolean {
  try {
    if (context.data.session.status(sessionID) === "running") return true
    const pendentes = context.data.session.pending.list(sessionID) ?? []
    return pendentes.some((item) => (item as ItemInbox)?.type !== "synthetic")
  } catch {
    return false
  }
}

/** Nomes de pasta aceitos (o plugin pode estar instalado com qualquer um). */
const PASTAS = ["painel-retro", "opencode-painel-retro"]

/**
 * Tenta descobrir a pasta do próprio módulo (Bun/Node ESM).
 * Se não der, caímos nos caminhos convencionais abaixo.
 */
function pastaDoModulo(): string | undefined {
  try {
    const meta = import.meta as unknown as { dir?: string; url?: string }
    if (meta && meta.dir) return meta.dir
    if (meta && meta.url && meta.url.startsWith("file:")) {
      return dirname(fileURLToPath(meta.url))
    }
  } catch {
    // sem import.meta: ignora
  }
  return undefined
}

/** Caminhos onde um `config.json` do plugin pode estar. */
function caminhosDoConfig(): string[] {
  const caminhos = []
  const modulo = pastaDoModulo()
  if (modulo) caminhos.push(join(modulo, "config.json"))

  for (const pasta of PASTAS) {
    try {
      caminhos.push(
        join(process.cwd(), ".opencode", "plugins", pasta, "config.json"),
      )
    } catch {
      break
    }
    const casa = process.env.HOME
    if (casa) {
      caminhos.push(
        join(casa, ".config", "opencode", "plugins", pasta, "config.json"),
      )
    }
  }
  return caminhos
}

/** Lê a configuração opcional do plugin (silencioso se não existir). */
function lerConfig(): Config {
  for (const caminho of caminhosDoConfig()) {
    try {
      const dados = JSON.parse(readFileSync(caminho, "utf8"))
      if (dados && typeof dados === "object") return dados as Config
    } catch {
      // arquivo ausente ou inválido: tenta o próximo
    }
  }
  return {}
}

/** Barra de uso do contexto do modelo (verde < 70%, amarelo ≥ 70%, vermelho ≥ 90%). */
function BarraContexto(props: { sessionID: string }) {
  const context = usePlugin()
  const tema = context.theme

  /** Tokens que o modelo leu/gerou na última resposta = ocupação do contexto. */
  const usado = createMemo(() => {
    try {
      const mensagens = context.data.session.message.list(props.sessionID) ?? []
      for (let i = mensagens.length - 1; i >= 0; i--) {
        const mensagem = mensagens[i] as MensagemSessao
        if (mensagem?.type !== "assistant") continue
        const t = mensagem.tokens
        if (!t) continue
        return (
          (t.input ?? 0) +
          (t.cache?.read ?? 0) +
          (t.cache?.write ?? 0) +
          (t.output ?? 0) +
          (t.reasoning ?? 0)
        )
      }
      return 0
    } catch {
      return 0
    }
  })

  /** Limite de contexto do modelo selecionado (Model.Info.limit.context). */
  const limite = createMemo(() => {
    try {
      const atual = context.ui.model.current()
      if (!atual) return 0
      const local = context.location ?? context.data.location.default()
      const modelos = (context.data.location.model.list(local) ??
        []) as ModeloInfo[]
      const achado = modelos.find(
        (m) => m.providerID === atual.providerID && m.id === atual.id,
      )
      return achado?.limit?.context ?? 0
    } catch {
      return 0
    }
  })

  const pct = createMemo(() => {
    const total = limite()
    if (!total) return 0
    return Math.min(100, Math.round((usado() / total) * 100))
  })

  const cor = createMemo(() => {
    const valor = pct()
    if (valor >= 90) return tema.text.feedback.error.base
    if (valor >= 70) return tema.text.feedback.warning.base
    return tema.text.feedback.success.base
  })

  const cheio = createMemo(() =>
    Math.max(
      0,
      Math.min(BLOCOS_CONTEXTO, Math.round((pct() / 100) * BLOCOS_CONTEXTO)),
    ),
  )

  return (
    <box flexDirection="row" gap={1} flexShrink={0} alignItems="center">
      <text fg={tema.text.muted}>ctx</text>
      <text fg={cor()}>{"█".repeat(cheio())}</text>
      <text fg={tema.text.muted}>{"░".repeat(BLOCOS_CONTEXTO - cheio())}</text>
      <text fg={cor()}>{limite() ? pct() + "%" : "--"}</text>
    </box>
  )
}

/** Status do git: contagem de arquivos novos/alterados/removidos. */
function StatusGit(props: { pasta?: string; intervalo: number }) {
  const context = usePlugin()
  const tema = context.theme
  const [contagem, setContagem] = createSignal<
    { novos: number; alterados: number; removidos: number } | undefined
  >(undefined)

  const buscar = async () => {
    try {
      const cliente = context.client as unknown as ClienteVcs
      const status = cliente?.vcs?.status
      if (!status || !props.pasta) return
      const resposta = await status({ location: { directory: props.pasta } })
      let novos = 0
      let alterados = 0
      let removidos = 0
      for (const arquivo of resposta?.data ?? []) {
        if (arquivo?.status === "added") novos++
        else if (arquivo?.status === "deleted") removidos++
        else alterados++
      }
      setContagem({ novos: novos, alterados: alterados, removidos: removidos })
    } catch {
      // sem repo, sem permissão ou fora do ar: simplesmente não mostra
    }
  }

  void buscar()
  const timer = setInterval(() => void buscar(), props.intervalo)
  onCleanup(() => clearInterval(timer))

  const dados = () => contagem()
  const sujo = () => {
    const c = dados()
    if (!c) return false
    return c.novos + c.alterados + c.removidos > 0
  }

  return (
    <box flexDirection="row" gap={1} flexShrink={0} alignItems="center">
      {dados() && !sujo() ? (
        <text fg={tema.text.feedback.success.base}>limpo</text>
      ) : null}
      {dados() && sujo() ? (
        <text fg={tema.text.feedback.warning.base}>
          {(dados()!.novos ? "✚" + dados()!.novos + " " : "") +
            (dados()!.alterados ? "~" + dados()!.alterados + " " : "") +
            (dados()!.removidos ? "-" + dados()!.removidos : "")}
        </text>
      ) : null}
    </box>
  )
}

/** Cronômetro do turno atual + quantos subagentes estão rodando. */
function Cronometro(props: { sessionID: string }) {
  const context = usePlugin()
  const tema = context.theme
  const [agora, setAgora] = createSignal(Date.now())
  const timer = setInterval(() => setAgora(Date.now()), 1000)
  onCleanup(() => clearInterval(timer))

  /** Subagentes da família da sessão que estão rodando agora. */
  const subagentes = createMemo(() => {
    try {
      const familia = context.data.session.family(props.sessionID) ?? []
      let ativos = 0
      for (const id of familia) {
        if (id === props.sessionID) continue
        if (context.data.session.status(id) === "running") ativos++
      }
      return ativos
    } catch {
      return 0
    }
  })

  /** Quando o turno atual começou (fila de entrada ou última mensagem do usuário). */
  const inicio = createMemo(() => {
    try {
      let menor = 0
      const pendentes = context.data.session.pending.list(props.sessionID) ?? []
      for (const item of pendentes) {
        if ((item as ItemInbox)?.type === "synthetic") continue
        const quando = (item as ItemInbox)?.time?.created ?? 0
        if (quando && (menor === 0 || quando < menor)) menor = quando
      }
      if (menor) return menor

      const mensagens = context.data.session.message.list(props.sessionID) ?? []
      for (let i = mensagens.length - 1; i >= 0; i--) {
        const mensagem = mensagens[i] as MensagemSessao
        if (mensagem?.type !== "user") continue
        return mensagem?.time?.created ?? 0
      }
      return 0
    } catch {
      return 0
    }
  })

  const segundos = createMemo(() => {
    if (!estaTrabalhando(context, props.sessionID)) return 0
    const quando = inicio()
    if (!quando) return 0
    return Math.max(0, Math.round((agora() - quando) / 1000))
  })

  return (
    <box flexDirection="row" gap={2} flexShrink={0} alignItems="center">
      {segundos() > 0 ? (
        <box flexDirection="row" gap={1} flexShrink={0}>
          <text fg={tema.text.feedback.info.base}>⏱</text>
          <text fg={tema.text.base}>{formatarDuracao(segundos())}</text>
        </box>
      ) : null}
      {subagentes() > 0 ? (
        <box flexDirection="row" gap={1} flexShrink={0}>
          <text fg={tema.text.feedback.warning.base}>⚡</text>
          <text fg={tema.text.base}>{subagentes() + " sub"}</text>
        </box>
      ) : null}
    </box>
  )
}

/** Aviso de bloqueio: permissão esperando, pergunta pendente ou fila. */
function LinhaBloqueio(props: { sessionID: string }) {
  const context = usePlugin()
  const tema = context.theme

  const permissao = createMemo(() => {
    try {
      const lista = context.data.session.permission.list(props.sessionID) ?? []
      return lista[0] as PedidoPermissao | undefined
    } catch {
      return undefined
    }
  })

  const formulario = createMemo(() => {
    try {
      const lista = context.data.session.form.list(props.sessionID) ?? []
      return lista[0] as FormularioInfo | undefined
    } catch {
      return undefined
    }
  })

  const fila = createMemo(() => {
    try {
      const pendentes = context.data.session.pending.list(props.sessionID) ?? []
      let naFila = 0
      for (const item of pendentes) {
        if ((item as ItemInbox)?.delivery === "queue") naFila++
      }
      return naFila
    } catch {
      return 0
    }
  })

  return (
    <box flexDirection="row" gap={3} flexShrink={0} alignItems="center">
      {permissao() ? (
        <box flexDirection="row" gap={1} flexShrink={0}>
          <text fg={tema.text.feedback.error.base}>⏸ permissão:</text>
          <text fg={tema.text.base}>
            {encurtar(String(permissao()?.action ?? "?"), 30)}
          </text>
        </box>
      ) : null}
      {formulario() ? (
        <box flexDirection="row" gap={1} flexShrink={0}>
          <text fg={tema.text.feedback.warning.base}>❓ pergunta:</text>
          <text fg={tema.text.base}>
            {encurtar(String(formulario()?.title ?? "?"), 30)}
          </text>
        </box>
      ) : null}
      {fila() > 0 ? (
        <box flexDirection="row" gap={1} flexShrink={0}>
          <text fg={tema.text.feedback.info.base}>⏳</text>
          <text fg={tema.text.base}>{fila() + " na fila"}</text>
        </box>
      ) : null}
    </box>
  )
}

function Painel(props: {
  sessionID: string
  config: Config
  intervaloGit: number
  mostrarContexto: boolean
  mostrarGit: boolean
  mostrarCronometro: boolean
  mostrarBloqueio: boolean
}) {
  const context = usePlugin()
  const tema = context.theme

  /** Localização atual do plugin (fallback para a padrão). */
  const local = createMemo(() => {
    try {
      return context.location ?? context.data.location.default()
    } catch {
      return undefined
    }
  })

  /** Diretório cru da sessão (usado no `git status`). */
  const diretorio = createMemo(() => {
    try {
      const sessao = context.data.session.get(props.sessionID) as unknown as
        | SessaoComPasta
        | undefined
      return sessao?.location?.directory ?? context.location?.directory
    } catch {
      return undefined
    }
  })

  /** Branch atual do repositório. */
  const branch = createMemo(() => {
    try {
      const atual = local()
      if (!atual) return "sem repo"
      const info = context.data.location.vcs.info(atual)
      return info?.branch?.current ?? "sem repo"
    } catch {
      return "sem repo"
    }
  })

  /** Pasta da sessão (abreviando a home, como a sidebar faz). */
  const pasta = createMemo(() => {
    try {
      const caminho = diretorio()
      if (!caminho) return "—"
      return context.ui.format.path(caminho)
    } catch {
      return "—"
    }
  })

  /** Precisa mostrar a linha de bloqueio? */
  const temBloqueio = createMemo(() => {
    try {
      const permissoes =
        (context.data.session.permission.list(props.sessionID) ?? []).length
      const formularios = (context.data.session.form.list(props.sessionID) ?? [])
        .length
      if (permissoes > 0 || formularios > 0) return true
      const pendentes = context.data.session.pending.list(props.sessionID) ?? []
      return pendentes.some((item) => (item as ItemInbox)?.delivery === "queue")
    } catch {
      return false
    }
  })

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={tema.border.base}
      title=" OPENCODE "
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
      flexShrink={0}
      gap={0}
    >
      <box flexDirection="row" gap={2} flexShrink={0} alignItems="center">
        <box flexDirection="row" gap={1} flexShrink={0}>
          <text fg={tema.text.feedback.info.base}>⑂</text>
          <text fg={tema.text.base}>{encurtar(branch(), 40)}</text>
        </box>
        {props.mostrarGit ? (
          <StatusGit pasta={diretorio()} intervalo={props.intervaloGit} />
        ) : null}
      </box>

      <box flexDirection="row" gap={2} flexShrink={0} alignItems="center">
        <box flexDirection="row" gap={1} flexShrink={0}>
          <text fg={tema.text.feedback.info.base}>⌂</text>
          <text fg={tema.text.muted}>{encurtarInicio(pasta(), 46)}</text>
        </box>
        {props.mostrarContexto ? (
          <BarraContexto sessionID={props.sessionID} />
        ) : null}
        {props.mostrarCronometro ? (
          <Cronometro sessionID={props.sessionID} />
        ) : null}
      </box>

      {props.mostrarBloqueio && temBloqueio() ? (
        <LinhaBloqueio sessionID={props.sessionID} />
      ) : null}
    </box>
  )
}

/** Cena animada (trabalhando) ou banner de espera (parado). */
function Cena(props: {
  sessionID: string
  intervalo: number
  escalaBanner: number
}) {
  const context = usePlugin()
  const [quadro, setQuadro] = createSignal<
    Array<Array<{ cor: string; texto: string }>>
  >([])

  const cores: Record<string, unknown> = {
    ceu: context.theme.text.muted,
    chuva:
      context.theme.hue?.purple?.[400] ??
      context.theme.hue?.accent?.[300] ??
      context.theme.text.feedback.info.base,
    agua: context.theme.hue?.purple?.[700] ?? context.theme.text.muted,
    robo: context.theme.hue?.cyan?.[300] ?? context.theme.text.base,
    roboMini:
      context.theme.hue?.green?.[400] ??
      context.theme.text.feedback.success.base,
    olho:
      context.theme.hue?.yellow?.[400] ?? context.theme.text.feedback.warning.base,
    antena: context.theme.text.feedback.error.base,
    chao: context.theme.hue?.cyan?.[600] ?? context.theme.text.muted,
    banner: context.theme.hue?.cyan?.[400] ?? context.theme.text.feedback.info.base,
    pontos: context.theme.text.feedback.warning.base,
  }

  const pintar = (chave: string) =>
    (cores[chave] ?? context.theme.text.base) as string

  const trabalhando = createMemo(() => estaTrabalhando(context, props.sessionID))

  /** Subagentes rodando agora: cada um vira um robô pequeno na cena. */
  const subagentes = createMemo(() => {
    try {
      const familia = context.data.session.family(props.sessionID) ?? []
      let ativos = 0
      for (const id of familia) {
        if (id === props.sessionID) continue
        if (context.data.session.status(id) === "running") ativos++
      }
      return ativos
    } catch {
      return 0
    }
  })

  let motor: ReturnType<typeof criarCena> | undefined
  let larguraAtual = 0
  let fasePontos = -1
  let larguraBanner = 0

  /** Largura útil em colunas (acompanha o redimensionamento da janela). */
  const medirLargura = () => {
    let colunas = 0
    try {
      colunas = process.stdout?.columns ?? 0
    } catch {
      colunas = 0
    }
    if (!colunas || colunas < 20) colunas = 100
    return Math.max(24, colunas - 8)
  }

  /** Um "tick": avança a cena ou atualiza o banner parado. */
  const tick = () => {
    const largura = medirLargura()

    if (trabalhando()) {
      if (!motor || larguraAtual !== largura) {
        motor = criarCena(largura)
        larguraAtual = largura
      }
      motor.definirSubagentes(subagentes())
      motor.passo()
      setQuadro(motor.quadro())
      fasePontos = -1
      larguraBanner = 0
      return
    }

    // parado: o robô desliga e o quadro vira o banner
    motor = undefined
    larguraAtual = 0

    const fase = 1 + (Math.floor(Date.now() / PERIODO_PONTOS) % MAX_PONTOS)
    if (fase !== fasePontos || larguraBanner !== largura) {
      fasePontos = fase
      larguraBanner = largura
      setQuadro(quadroAguardando(largura, fase, props.escalaBanner))
    }
  }

  tick()
  const timer = setInterval(tick, props.intervalo)
  onCleanup(() => clearInterval(timer))

  return (
    <box width="100%" flexDirection="column" flexShrink={0} overflow="hidden">
      <Index each={quadro()}>
        {(linha) => (
          <box flexDirection="row" width="100%" flexShrink={0}>
            <Index each={linha()}>
              {(segmento) => (
                <text fg={pintar(segmento().cor)} wrapMode="none" flexShrink={0}>
                  {segmento().texto}
                </text>
              )}
            </Index>
          </box>
        )}
      </Index>
    </box>
  )
}

export default Plugin.define({
  id: "painel-retro",
  setup(context) {
    const config = lerConfig()
    const opcoes = (context.options ?? {}) as Record<string, unknown>

    const mostraCena = config.animacao !== false && opcoes.animacao !== false
    const fpsPedido = Number(config.fps ?? opcoes.fps)
    const intervalo =
      Number.isFinite(fpsPedido) && fpsPedido >= 60 && fpsPedido <= 1000
        ? fpsPedido
        : INTERVALO_PADRAO
    // escala do banner de espera: 1 (padrão, menor) ou 2 (dobrado)
    const escalaBanner = Number(config.escalaBanner) === 2 ? 2 : 1

    // itens extras do painel (todos ligados por padrão)
    const mostrarContexto = config.contexto !== false
    const mostrarGit = config.git !== false
    const mostrarCronometro = config.cronometro !== false
    const mostrarBloqueio = config.bloqueio !== false
    const gitPedido = Number(config.intervaloGit)
    const intervaloGit =
      Number.isFinite(gitPedido) && gitPedido >= 1000 && gitPedido <= 120000
        ? gitPedido
        : INTERVALO_GIT_PADRAO

    return context.ui.slot({
      append: "session.composer.top",
      render: ({ sessionID }) => (
        <box flexDirection="column" flexShrink={0} width="100%">
          <Painel
            sessionID={sessionID}
            config={config}
            intervaloGit={intervaloGit}
            mostrarContexto={mostrarContexto}
            mostrarGit={mostrarGit}
            mostrarCronometro={mostrarCronometro}
            mostrarBloqueio={mostrarBloqueio}
          />
          {mostraCena ? (
            <Cena
              sessionID={sessionID}
              intervalo={intervalo}
              escalaBanner={escalaBanner}
            />
          ) : null}
        </box>
      ),
    })
  },
})
