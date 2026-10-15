# 📟 opencode-painel-retro

Plugin de **TUI do OpenCode (v2)** que coloca um painel e uma **cena ASCII animada**
logo **acima do campo de prompt**.

- 🎛️ **Painel** — título `OPENCODE`, o **branch** atual e a **pasta da sessão**.
- 🤖 **Modelo trabalhando** — um robô cyberpunk **andando da esquerda para a direita**
  na **chuva neon** (com braços que remam, corpo balançando e chão rolando).
- 💤 **Sessão ociosa** — o quadro inteiro vira o banner ASCII
  **`AGUARDANDO COMANDOS...`**, com os pontinhos piscando.

---

## 👀 Preview

**Painel (sempre visível):**

```
╭─ OPENCODE ────────────────────────────────────────────────╮
│ ⑂ feature/minha-branch                                    │
│ ⌂ ~/dev/meu-projeto                                       │
╰───────────────────────────────────────────────────────────╯
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
  "animacao": true     // false desliga o robô e o banner
}
```

| Opção | Padrão | O que faz |
|---|---|---|
| `escalaBanner` | `1` | `1` = banner pequeno e centralizado; `2` = dobrado (só se couber na largura) |
| `fps` | `140` | Intervalo entre quadros em ms. Menor = mais fluido e mais CPU |
| `animacao` | `true` | `false` remove a cena inteira (fica só o painel) |

O OpenCode também aceita as mesmas opções via `options` na configuração de plugins.

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
