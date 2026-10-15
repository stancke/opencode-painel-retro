import { Plugin } from "@opencode/plugin"

/**
 * Entrada de servidor do plugin "painel-retro".
 *
 * O plugin é essencialmente de TUI (ver `tui.tsx`), que desenha um painel
 * acima do campo de prompt. Esta entrada existe apenas para que o OpenCode
 * reconheça o diretório como um plugin completo (server + tui) e para que o
 * plugin apareça em `opencode plugin list`.
 */
export default Plugin.define({
  id: "painel-retro",
  setup() {},
})
