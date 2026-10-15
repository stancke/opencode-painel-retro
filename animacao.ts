/**
 * Motor dos visuais do painel:
 *
 *  1) `criarCena()`      -> robô cyberpunk andando da esquerda para a direita
 *                           (ciclo de passada, balanço e chão rolando).
 *  2) `quadroAguardando()` -> banner ASCII "AGUARDANDO COMANDOS..." para quando
 *                           a sessão está parada.
 *
 * Escrito em JS puro (apenas JSDoc) de propósito: o mesmo arquivo é carregado
 * pelo OpenCode (transform de TS do Bun) e pode ser testado isoladamente no
 * Node, sem build. Todos os caracteres são de largura 1 (NARROW), para não
 * quebrar o alinhamento do terminal.
 *
 * `quadro()`/`quadroAguardando()` devolvem linhas compostas de SEGMENTOS com uma
 * chave de cor, para o plugin pintar cada pedaço com um token do tema:
 *
 *   ceu | estrela | robo | olho | antena | chao | banner | pontos
 */

/** Total de linhas do quadro. */
export const LINHAS_CENA = 8

/** Linha do chão. */
const LINHA_CHAO = 6

/** Quadros entre cada coluna andada (velocidade do robô). */
const QUADROS_POR_PASSO = 2

/** Quadros entre cada troca de passada. */
const QUADROS_POR_PASSADA = 4

/** Marca do chão (anda para trás, dando sensação de caminhada). */
const MARCA_CHAO = "▪"

/** Largura do sprite do robô. */
const LARGURA_ROBO = 15

/** Altura do sprite do robô. */
const ALTURA_ROBO = 5

/**
 * Robô quadrado (visto de frente) — linhas 0 a 3. O visor tem cor própria.
 * Cada linha é uma lista de segmentos `{ cor, texto }`, todas com 15 colunas.
 */
const ROBO_BASE = [
  [{ cor: "antena", texto: "       ▲       " }],
  [{ cor: "robo", texto: "   ┌───────┐   " }],
  [
    { cor: "robo", texto: "   │█ " },
    { cor: "olho", texto: "▀▀▀" },
    { cor: "robo", texto: " █│   " },
  ],
  [{ cor: "robo", texto: "  ┌┴███████┴┐  " }],
]

/** Pernas (linha 4): duas poses que alternam a cada passada. */
const PERNAS = [
  [{ cor: "robo", texto: "     ▐█ █▌     " }],
  [{ cor: "robo", texto: "     ▐▙ ▟▌     " }],
]

/** Braço (2 células de altura), preso nas laterais do tronco. */
const BRACO_ESQ = "▐"
const BRACO_DIR = "▌"

/** Coluna do braço esquerdo e direito dentro do sprite. */
const COLUNA_BRACO_ESQ = 1
const COLUNA_BRACO_DIR = 13

/** Quantidade de gotas de chuva (proporcional à largura). */
const GOTAS_POR_COLUNA = 2

/** Caracteres da gota, da cabeça (embaixo) para a cauda (em cima). */
const CHUVA_CHARS = ["│", ":", "."]

/** Comprimento da cauda da gota. */
const CAUDA_CHUVA = CHUVA_CHARS.length

/** Ruído determinístico em [0, 1). */
function ruido(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** Cria um "canvas" de uma linha: desenha chars e agrupa em segmentos de cor. */
function criarLinha(tamanho, corPadrao) {
  const chars = new Array(tamanho).fill(" ")
  const cores = new Array(tamanho).fill(corPadrao)
  return {
    tamanho: tamanho,
    /** Pinta um caractere. */
    por(x, ch, cor) {
      const i = Math.round(x)
      if (i < 0 || i >= tamanho) return
      chars[i] = ch
      cores[i] = cor
    },
    /** Pinta um texto a partir de x. */
    escrever(x, texto, cor) {
      for (let i = 0; i < texto.length; i++) this.por(x + i, texto[i], cor)
    },
    /** Junta células vizinhas de mesma cor em segmentos. */
    segmentos() {
      const saida = []
      let i = 0
      while (i < tamanho) {
        const cor = cores[i]
        let texto = ""
        while (i < tamanho && cores[i] === cor) {
          texto += chars[i]
          i++
        }
        saida.push({ cor: cor, texto: texto })
      }
      return saida
    },
  }
}

/** Chuvas neon caindo: gotas com cauda, inclinadas para a esquerda. */
function desenharChuva(linhas, gotas, t) {
  // avança as gotas
  for (const gota of gotas) {
    gota.y += gota.v
    if (gota.y > LINHA_CHAO + 1) {
      gota.y = -2 - ruido(gota.semente + t * 0.37) * 8
      gota.v = 0.45 + ruido(gota.semente * 3.7 + t * 0.11) * 0.95
    }
  }

  // desenha: cabeça embaixo, cauda subindo e inclinando para a esquerda
  // (a chuva para no chão, sem invadir a linha d'água)
  for (const gota of gotas) {
    const cabeca = Math.floor(gota.y)
    for (let k = 0; k < CAUDA_CHUVA; k++) {
      const r = cabeca - k
      if (r < 0 || r > LINHA_CHAO) continue
      linhas[r].por(gota.x - k, CHUVA_CHARS[k], "chuva")
    }
  }
}

/** Chão com marcas correndo para trás. */
function desenharChao(linha, t) {
  for (let x = 0; x < linha.tamanho; x++) linha.por(x, "─", "chao")

  const passo = 14
  const fase = Math.floor(t / 2) % passo
  for (let k = -1; k <= Math.ceil(linha.tamanho / passo) + 1; k++) {
    linha.por(k * passo - fase, MARCA_CHAO, "chao")
  }
}

/** Linha d'água abaixo do chão: brilhos espalhados (asfalto molhado). */
function desenharMolhado(linha, t) {
  for (let x = 0; x < linha.tamanho; x++) {
    const brilho = ruido(x * 2.71 + Math.floor(t / 4) * 1.37)
    if (brilho > 0.9) {
      linha.por(x, brilho > 0.96 ? "~" : "·", "agua")
    }
  }
}

/** Braço: duas células na vertical, alternando para cima/para baixo. */
function desenharBraco(linhas, x, coluna, topo, levantado) {
  const inicio = topo + (levantado ? 2 : 3)
  for (let k = 0; k < 2; k++) {
    const linha = linhas[inicio + k]
    if (linha) linha.por(x + coluna, coluna < 7 ? BRACO_ESQ : BRACO_DIR, "robo")
  }
}

/** Desenha o robô na posição `x`, com a passada atual e o balanço do corpo. */
function desenharRobo(linhas, x, passada, balanco) {
  const topo = 1 + balanco // com o balanço, o robô desce 1 linha (pisa no chão)

  for (let i = 0; i < ROBO_BASE.length; i++) {
    const linha = linhas[topo + i]
    if (!linha) continue
    let deslocamento = x
    for (const pedaco of ROBO_BASE[i]) {
      linha.escrever(deslocamento, pedaco.texto, pedaco.cor)
      deslocamento += pedaco.texto.length
    }
  }

  // pernas
  const linhaPernas = linhas[topo + ROBO_BASE.length]
  if (linhaPernas) {
    let deslocamento = x
    for (const pedaco of PERNAS[passada % PERNAS.length]) {
      linhaPernas.escrever(deslocamento, pedaco.texto, pedaco.cor)
      deslocamento += pedaco.texto.length
    }
  }

  // braços, sempre em oposição (um sobe enquanto o outro desce)
  desenharBraco(linhas, x, COLUNA_BRACO_ESQ, topo, passada % 2 === 0)
  desenharBraco(linhas, x, COLUNA_BRACO_DIR, topo, passada % 2 !== 0)
}

/**
 * Cria o motor da cena com o robô andando na chuva.
 *
 * @param {number} largura colunas do quadro
 * @returns {{passo: () => void, quadro: () => Array<Array<{cor: string, texto: string}>>, colunas: number}}
 */
export function criarCena(largura) {
  const total = Math.max(24, Math.floor(largura))
  let t = 0
  let x = -LARGURA_ROBO
  let passada = 0

  // gotas de chuva espalhadas pelo quadro
  const gotas = []
  const quantidade = Math.max(8, Math.round(total / GOTAS_POR_COLUNA))
  for (let i = 0; i < quantidade; i++) {
    gotas.push({
      semente: i * 7.31 + 1.7,
      x: Math.floor(ruido(i * 4.13) * total),
      y: ruido(i * 9.71) * (LINHA_CHAO + 4) - 2,
      v: 0.45 + ruido(i * 2.77) * 0.95,
    })
  }

  /** Avança um quadro. */
  function passo() {
    t++
    if (t % QUADROS_POR_PASSO === 0) {
      x++
      // saiu pela direita: volta a entrar pela esquerda
      if (x > total + 2) x = -LARGURA_ROBO
    }
    if (t % QUADROS_POR_PASSADA === 0) passada++
  }

  /** Quadro completo. */
  function quadro() {
    const linhas = []
    // a cor-padrão de cada linha é a cor dominante dela: assim células vazias
    // se fundem com o desenho e o quadro gera poucos segmentos (menos nós)
    const padrao = [
      "chuva",
      "chuva",
      "chuva",
      "chuva",
      "chuva",
      "chuva",
      "chao",
      "agua",
    ]
    for (let i = 0; i < LINHAS_CENA; i++) {
      linhas.push(criarLinha(total, padrao[i]))
    }

    desenharChuva(linhas, gotas, t)
    desenharChao(linhas[LINHA_CHAO], t)
    desenharMolhado(linhas[LINHA_CHAO + 1], t)
    desenharRobo(linhas, x, passada, passada % 2)

    return linhas.map((linha) => linha.segmentos())
  }

  return { passo: passo, quadro: quadro, colunas: total }
}

/**
 * Fonte de blocos (5 linhas) usada no banner de espera.
 * Só as letras necessárias para "AGUARDANDO COMANDOS".
 */
const FONTE = {
  A: [" ██ ", "█  █", "████", "█  █", "█  █"],
  C: [" ███", "█   ", "█   ", "█   ", " ███"],
  D: ["████ ", "█   █", "█   █", "█   █", "████ "],
  G: [" ████", "█    ", "█  ██", "█   █", " ███ "],
  M: ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
  N: ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
  O: [" ███ ", "█   █", "█   █", "█   █", " ███ "],
  R: ["████ ", "█   █", "████ ", "█  █ ", "█   █"],
  S: [" ████", "█    ", " ███ ", "    █", "████ "],
  U: ["█   █", "█   █", "█   █", "█   █", " ███ "],
  " ": ["  ", "  ", "  ", "  ", "  "],
}

/** Ponto do "..." (só na última linha). */
const GLIFO_PONTO = [" ", " ", " ", " ", "█"]

/** Altura da fonte de blocos. */
const ALTURA_FONTE = 5

/** Texto do banner de espera. */
export const TEXTO_ESPERA = "AGUARDANDO COMANDOS"

/** Máximo de pontos animados no fim do banner. */
export const MAX_PONTOS = 3

/** Repete cada caractere `vezes` vezes (escala horizontal). */
function dobrar(texto, vezes) {
  if (vezes <= 1) return texto
  let saida = ""
  for (const ch of texto) saida += ch.repeat(vezes)
  return saida
}

/**
 * Monta o banner de espera em blocos, com os "..." animados no fim.
 * A largura é fixa (reserva os pontos), então o banner nunca "pula" ao piscar.
 *
 * @param {number} pontos quantidade de pontos visíveis (0..MAX_PONTOS)
 * @param {number} escala 1 ou 2 (dobra a largura)
 */
function montarBanner(pontos, escala) {
  const linhas = []
  for (let r = 0; r < ALTURA_FONTE; r++) linhas.push("")

  let larguraTexto = 0
  for (let i = 0; i < TEXTO_ESPERA.length; i++) {
    const glifo = FONTE[TEXTO_ESPERA[i]] ?? FONTE[" "]
    for (let r = 0; r < ALTURA_FONTE; r++) {
      linhas[r] += dobrar(glifo[r], escala) + " ".repeat(escala)
    }
    larguraTexto += glifo[0].length * escala + escala
  }
  const comprimento = larguraTexto - escala // sem o gap final

  const larguraPontos = MAX_PONTOS * escala * 2 - escala
  const larguraTotal = comprimento + escala + larguraPontos

  const saida = []
  for (let r = 0; r < ALTURA_FONTE; r++) {
    saida.push({
      texto: linhas[r].padEnd(comprimento, " "),
      pontos: r === ALTURA_FONTE - 1 ? pontos : 0,
    })
  }

  return {
    linhas: saida,
    larguraTexto: comprimento,
    larguraTotal: larguraTotal,
    escala: escala,
  }
}

/**
 * Quadro do estado "aguardando comandos": o quadro inteiro vira o banner
 * em ASCII, com os pontinhos piscando. O banner fica centralizado.
 *
 * @param {number} largura colunas do quadro
 * @param {number} pontos pontos visíveis (0..MAX_PONTOS)
 * @param {number} escalaPreferida 1 (padrão, metade do tamanho) ou 2
 * @returns {Array<Array<{cor: string, texto: string}>>}
 */
export function quadroAguardando(largura, pontos, escalaPreferida) {
  const total = Math.max(24, Math.floor(largura))
  const visiveis = Math.max(0, Math.min(MAX_PONTOS, Math.floor(pontos)))

  // por padrão o banner sai em escala 1 (menor); a escala 2 só é usada se o
  // usuário pedir E couber na largura disponível
  const medida = montarBanner(0, 1).larguraTotal
  const escala =
    escalaPreferida >= 2 && medida * 2 + 4 <= total ? 2 : 1
  const banner = montarBanner(visiveis, escala)

  const saida = []
  const topo = Math.max(0, Math.floor((LINHAS_CENA - ALTURA_FONTE) / 2))

  if (banner.larguraTotal <= total) {
    const recuo = Math.floor((total - banner.larguraTotal) / 2)
    for (let r = 0; r < LINHAS_CENA; r++) {
      const linha = criarLinha(total, "ceu")
      const i = r - topo
      if (i >= 0 && i < ALTURA_FONTE) {
        const bloco = banner.linhas[i]
        linha.escrever(recuo, bloco.texto, "banner")
        for (let p = 0; p < bloco.pontos; p++) {
          const x = recuo + banner.larguraTexto + escala + p * escala * 2
          linha.escrever(x, dobrar(GLIFO_PONTO[i], escala), "pontos")
        }
      }
      saida.push(linha.segmentos())
    }
    return saida
  }

  // terminal estreito: banner simples, em uma linha só
  const texto = TEXTO_ESPERA + ".".repeat(visiveis)
  const linhaTexto = Math.max(0, Math.floor((LINHAS_CENA - 3) / 2))
  for (let r = 0; r < LINHAS_CENA; r++) {
    const linha = criarLinha(total, "ceu")
    if (r === linhaTexto) {
      linha.escrever(0, "╭" + "─".repeat(total - 2) + "╮", "banner")
    } else if (r === linhaTexto + 1) {
      const recuo = Math.max(0, Math.floor((total - texto.length) / 2))
      linha.escrever(0, "│" + " ".repeat(total - 2) + "│", "banner")
      linha.escrever(recuo, texto, "pontos")
    } else if (r === linhaTexto + 2) {
      linha.escrever(0, "╰" + "─".repeat(total - 2) + "╯", "banner")
    }
    saida.push(linha.segmentos())
  }
  return saida
}
