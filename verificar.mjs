/**
 * Validador do plugin painel-retro (roda no Node, sem build).
 *
 * Checa duas coisas que já derrubaram o slot:
 *  1. sintaxe TS/TSX;
 *  2. texto JSX que sobrevive ao "clean" e cairia direto dentro de um <box>
 *     (o OpenTUI lança: Orphan text error: "..." must have a <text> as a parent).
 *     Isso acontece quando sobra um espaço na MESMA linha do <box>, por exemplo:
 *     `    >      <box ...>`.
 *
 * Uso (da raiz do projeto, que tem @babel/parser):
 *   node .opencode/plugins/painel-retro/verificar.mjs
 */
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const pasta = dirname(fileURLToPath(import.meta.url))

const ARQUIVOS = [
  ["tui.tsx", ["typescript", "jsx"]],
  ["animacao.ts", ["typescript"]],
  ["index.ts", ["typescript"]],
]

let parser
try {
  parser = require("@babel/parser")
} catch {
  console.error("Falta o @babel/parser: rode da raiz do projeto (node_modules/@babel/parser)")
  process.exit(2)
}

/** Nome do elemento JSX (text, box, Index, ...). */
function nomeDoElemento(no) {
  if (!no) return ""
  if (no.type === "JSXIdentifier") return no.name
  if (no.type === "JSXMemberExpression") {
    return nomeDoElemento(no.object) + "." + nomeDoElemento(no.property)
  }
  return ""
}

let problemas = 0

/** Percorre a árvore JSX carregando se estamos dentro de um <text>. */
function visitar(no, dentroDeText, arquivo) {
  if (!no || typeof no !== "object") return
  if (Array.isArray(no)) {
    for (const item of no) visitar(item, dentroDeText, arquivo)
    return
  }

  if (no.type === "JSXElement") {
    const ehText = nomeDoElemento(no.openingElement.name) === "text"
    visitar(no.openingElement.attributes, dentroDeText, arquivo)
    for (const filho of no.children) visitar(filho, dentroDeText || ehText, arquivo)
    return
  }

  if (no.type === "JSXText") {
    // O "clean" do JSX só descarta linha que tem quebra de linha.
    // Texto que é só espaços SEM quebra de linha sobrevive e vira nó de texto.
    const temQuebra = /[\r\n]/.test(no.value)
    const sobrevive = temQuebra
      ? no.value.replace(/[ \t]*[\r\n]+[ \t]*/g, "")
      : no.value
    if (sobrevive.length > 0 && !dentroDeText) {
      console.log(
        "TEXTO SOLTO  " +
          arquivo +
          " linha " +
          no.loc.start.line +
          " -> " +
          JSON.stringify(sobrevive) +
          "  (tem que estar dentro de <text>)",
      )
      problemas++
    }
    return
  }

  // JSXFragment, ExpressionContainer, etc.: filhos herdam o estado
  for (const chave of Object.keys(no)) {
    if (chave === "loc" || chave === "start" || chave === "end") continue
    visitar(no[chave], dentroDeText, arquivo)
  }
}

for (const [nome, plugins] of ARQUIVOS) {
  const codigo = readFileSync(join(pasta, nome), "utf8")
  let ast
  try {
    ast = parser.parse(codigo, { sourceType: "module", plugins })
    console.log("sintaxe OK   " + nome)
  } catch (erro) {
    console.log("SINTAXE RUIM " + nome + " -> " + erro.message)
    problemas++
    continue
  }
  visitar(ast.program, false, nome)
}

console.log(problemas === 0 ? "\ntudo certo ✔" : "\n" + problemas + " problema(s)")
process.exit(problemas === 0 ? 0 : 1)
