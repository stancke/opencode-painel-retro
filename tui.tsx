import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { Index, createMemo, createSignal, onCleanup } from "solid-js"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { criarCena, MAX_PONTOS, quadroAguardando } from "./animacao"

/**
 * Painel OPENCODE + cena ASCII cyberpunk animada, exibidos ACIMA do prompt.
 *
 * Painel: branch atual e pasta da sessão.
 *
 * Estados da cena:
 *   - sessão trabalhando (`status === "running"`): robô cyberpunk andando
 *     da esquerda para a direita.
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

/** Configuração opcional lida de `config.json` dentro da pasta do plugin. */
type Config = {
  /** Quadro da animação em ms (60..1000). */
  fps?: number
  /** `false` desliga a cena e o banner. */
  animacao?: boolean
  /** Tamanho do banner de espera: 1 (padrão) ou 2 (dobrado). */
  escalaBanner?: number
}

/** Só o campo da sessão que este plugin usa. */
type SessaoComPasta = { location?: { directory?: string } }

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

function Painel(props: { sessionID: string }) {
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
      const sessao = context.data.session.get(props.sessionID) as unknown as
        | SessaoComPasta
        | undefined
      const diretorio =
        sessao?.location?.directory ?? context.location?.directory
      if (!diretorio) return "—"
      return context.ui.format.path(diretorio)
    } catch {
      return "—"
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
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={tema.text.feedback.info.base}>⑂</text>
        <text fg={tema.text.base}>{encurtar(branch(), 60)}</text>
      </box>

      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={tema.text.feedback.info.base}>⌂</text>
        <text fg={tema.text.muted}>{encurtarInicio(pasta(), 80)}</text>
      </box>
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
    olho:
      context.theme.hue?.yellow?.[400] ?? context.theme.text.feedback.warning.base,
    antena: context.theme.text.feedback.error.base,
    chao: context.theme.hue?.cyan?.[600] ?? context.theme.text.muted,
    banner: context.theme.hue?.cyan?.[400] ?? context.theme.text.feedback.info.base,
    pontos: context.theme.text.feedback.warning.base,
  }

  const pintar = (chave: string) =>
    (cores[chave] ?? context.theme.text.base) as string

  /** O modelo está trabalhando? (mesma regra usada pela sidebar do OpenCode) */
  const trabalhando = createMemo(() => {
    try {
      if (context.data.session.status(props.sessionID) === "running") return true
      const pendentes =
        context.data.session.pending.list(props.sessionID) ?? []
      return pendentes.some((item) => item.type !== "synthetic")
    } catch {
      return false
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

    return context.ui.slot({
      append: "session.composer.top",
      render: ({ sessionID }) => (
        <box flexDirection="column" flexShrink={0} width="100%">
          <Painel sessionID={sessionID} />
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
