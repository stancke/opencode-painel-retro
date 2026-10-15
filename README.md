# 📟 opencode-painel-retro

Plugin de **TUI do OpenCode (v2)** que coloca um painel e uma **cena ASCII animada**
logo **acima do campo de prompt**.

- 🎛️ **Painel** — **branch**, **estado do git** (✚novos ~alterados -removidos), **pasta da
  sessão**, **uso do contexto** (barra com %) e **cronômetro do turno + subagentes
  rodando**. Quando algo trava, entra uma linha extra com **⏸ permissão**,
  **❓ pergunta** ou **⏳ fila de prompts**.
- 🤖 **Modelo trabalhando** — um robô cyberpunk **andando da esquerda para a direita**
  na **chuva neon** (com braços que remam, corpo balançando e chão rolando).
- 🤖➕ **Subagentes** — cada subagente em execução vira um **robô menor** (verde) que
  anda junto na cena; o robô grande é o **orquestrador**.
- 💤 **Sessão ociosa** — o quadro inteiro vira o banner ASCII
  **`AGUARDANDO COMANDOS...`**, com os pontinhos piscando.

---

## 👀 Preview

**Painel (sempre visível):**

```
╭─ OPENCODE ────────────────────────────────────────────────────────────────╮
│ ⑂ feature/minha-branch                ✚3 ~1 -2                           │
│ ⌂ ~/dev/meu-projeto          ctx ████████░░░░ 62%   ⏱ 3m12s  ⚡2 sub      │
╰───────────────────────────────────────────────────────────────────────────╯
```

**E quando tem algo esperando você:**

```
╭─ OPENCODE ────────────────────────────────────────────────────────────────╮
│ ⑂ main                                limpo                               │
│ ⌂ ~/dev/meu-projeto                                        ⏱ 12s         │
│ ⏸ permissão: bash                   ⏳ 2 na fila                          │
╰───────────────────────────────────────────────────────────────────────────╯
```

**Trabalhando (7 quadros por segundo):**

```
    │      .     │           . │    .    │        │
 :           :                 :      :            │
  │                ▲            │      │  .        │
   .           ┌───────┐                  .:       │
    :          │█ ▀▀▀ █│ ▌                 :│      │
     │       ▐┌┴███████┴┐▌                  │      │
 ──────────▪ ▐   ▐▙ ▟▌     ────────────▪───────────│
     ·     ·        ~~         ·           ·  ·    │
```

**Ocioso:**

```
                                      ██   ████ █   █  ██  ████  ████
                                     █  █ █     █   █ █  █ █   █ █   █
                                     ████ █  ██ █   █ ████ ████  █   █
                                     █  █ █   █ █   █ █  █ █  █  █   █
                                     █  █  ███   ███  █  █ █   █ ████   █ █ █
```

---

## 🚀 Instalação

### Opção 1 — no projeto (mais simples)

```bash
mkdir -p .opencode/plugins
git clone https://github.com/stancke/opencode-painel-retro .opencode/plugins/painel-retro
```

Precisa estar em **`.opencode/plugins/painel-retro/`** (a pasta pode ter outro nome,
mas o `README` assume esse).

### Opção 2 — global (vale em todos os projetos)

```bash
mkdir -p ~/.config/opencode/plugins
git clone https://github.com/stancke/opencode-painel-retro \
  ~/.config/opencode/plugins/painel-retro
```

Depois é só abrir (ou reiniciar) o OpenCode. Não precisa `npm install`, build nem
`node_modules`: o OpenCode injeta `@opencode/plugin/tui`, `solid-js` e
`@opentui/solid` em tempo de execução.

> 💡 O slot é remontado quando o composer re-renderiza. Se você editar o plugin e o
> painel parecer "velho", envie um prompt, troque de aba/sessão ou use `/plugins`
> para desabilitar/habilitar.

---

## ⚙️ Configuração

Todas as opções são opcionais. Crie o arquivo **na pasta do plugin**:

`.opencode/plugins/painel-retro/config.json` (ou `~/.config/opencode/plugins/painel-retro/config.json`)

```jsonc
{
  "escalaBanner": 1,   // tamanho do "AGUARDANDO COMANDOS...": 1 (padrão) ou 2
  "fps": 140,          // ms por quadro da animação (60..1000)
  "animacao": true,    // false desliga o robô/banner
  "contexto": true,    // barra de uso do contexto
  "git": true,         // status do git (✚novos ~alterados -removidos)
  "intervaloGit": 5000,// ms entre cada `git status` (1000..120000)
  "cronometro": true,  // cronômetro do turno + subagentes
  "bloqueio": true     // aviso de permissão/pergunta/fila
}
```

| Opção | Padrão | O que faz |
|---|---|---|
| `escalaBanner` | `1` | `1` = banner pequeno e centralizado; `2` = dobrado (só se couber na largura) |
| `fps` | `140` | Intervalo entre quadros em ms. Menor = mais fluido e mais CPU |
| `animacao` | `true` | `false` remove a cena inteira (fica só o painel) |
| `contexto` | `true` | Barra com o % do contexto do modelo já usado |
| `git` | `true` | Arquivos novos/alterados/removidos na árvore de trabalho (`limpo` quando nada) |
| `intervaloGit` | `5000` | Intervalo do `git status` — aumente em repositório grande |
| `cronometro` | `true` | Cronômetro do turno atual + quantos subagentes estão rodando |
| `bloqueio` | `true` | Linha de aviso quando há permissão/pergunta/fila esperando |

O OpenCode também aceita as mesmas opções via `options` na configuração de plugins.

### O que cada coisa significa

| No painel | De onde vem |
|---|---|
| `⑂ branch` | `data.location.vcs.info(location).branch.current` |
| `✚3 ~1 -2` / `limpo` | `client.vcs.status()` (contagem por status) |
| `⌂ caminho` | `data.session.get(id).location.directory` + `ui.format.path` |
| `ctx ███░░░ 62%` | último `tokens` do assistente ÷ `Model.Info.limit.context` |
| `⏱ 3m12s` | `time.created` do prompt em execução |
| `⚡2 sub` | sessões da família (`data.session.family`) com status `running` |
| `⏸ / ❓ / ⏳` | `session.permission.list`, `session.form.list`, `session.pending.list` (`delivery: "queue"`) |
| 🤖 robô grande | orquestrador (a sessão atual) |
| 🤖 robô pequeno | um por subagente rodando |

---

## 🧠 Como funciona

- Registra um slot em **`session.composer.top`** (o espaço logo acima do input).
- O estado "trabalhando" vem de **`data.session.status(sessionID) === "running"`**
  (mesma regra que a sidebar do OpenCode usa) ou de prompt pendente na fila.
- O motor da cena vive em `animacao.ts` e devolve o quadro em **segmentos com chave de
  cor**; o `tui.tsx` pinta cada segmento com um token do tema atual
  (`theme.hue.*` com fallback para `theme.text.feedback.*`).
- A cor-padrão de cada linha é a cor dominante dela, então as células vazias se fundem
  com o desenho: o quadro inteiro sai em **~20 nós de texto** por quadro (leve).

```
tui.tsx       -> painel, painel de estado (robô/banner), slot e paleta
animacao.ts   -> motor da cena (robô, chuva, chão) e do banner ASCII
index.ts      -> entrada de servidor (só registra o plugin)
verificar.mjs -> validador de desenvolvimento
```

---

## 🛠️ Desenvolvimento

```bash
npm install          # só para ter o @babel/parser
npm run verificar    # valida sintaxe + um detalhe importante do OpenTUI
```

O validador checa duas coisas:

1. **Sintaxe** TS/TSX dos arquivos.
2. **Texto JSX órfão** — o OpenTUI só aceita texto dentro de `<text>`; texto solto
   dentro de um `<box>` derruba o slot com:

   ```
   Orphan text error: " " must have a <text> as a parent
   ```

   A pegadinha: um espaço **na mesma linha** do `<box>` sobrevive ao "clean" do JSX e
   vira nó de texto. Exemplo que o validador pega:

   ```jsx
   <box>      <text>oi</text></box>   <!-- ✗ explode -->
   <box>
     <text>oi</text>                  <!-- ✓ ok -->
   </box>
   ```

---

## 📄 Licença

MIT — veja [LICENSE](./LICENSE).
