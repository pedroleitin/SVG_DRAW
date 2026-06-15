# Backlog — SVG Grid Generator

Controle de alterações e ideias futuras. Itens marcados `[ ]` estão pendentes,
`[x]` concluídos. Ver também o status das fases em [README.md](README.md).

> Convenção: cada item tem uma nota curta com a intenção e, quando útil, onde
> mexer no código. Prioridade sugerida: 🔴 alta · 🟡 média · ⚪ baixa.

---

## 1. Interface (UI/UX)

- [ ] 🟡 **Revisão do layout da interface** — reorganizar toolbar e sidebar,
  agrupar controles por contexto, melhorar hierarquia visual e responsividade.
  - Possível: painéis colapsáveis, abas (Grid / Pincel / Máscara / Export).
  - Arquivos: [index.html](index.html), [src/ui/](src/ui/), [src/ui/styles/app.css](src/ui/styles/app.css)
- [ ] 🔴 **Agrupar as funções por tipo** — definir uma taxonomia clara e refletir
  na UI. Grupos identificados até agora:
  - **Ferramentas de cena**: pintar (draw), apagar (erase), pan, desenhar ordem (path).
  - **Geração**: máscara de noise, escala multi-célula, fill/reseed.
  - **Aparência**: cores/paleta, formas/biblioteca, overlays (máscara, grid, ordem).
  - **Animação**: ciclo de vida, ordem, playback.
  - **Controles de tela / projeto**: undo/redo, zoom, clear, export, salvar/carregar.
  - Decidir o que vai na toolbar (topo), no sidebar (painéis) e em barras contextuais.

## 2. Grid

- [ ] 🟡 **Layout do grid** — mais opções além do tamanho de célula:
  - Grid retangular (largura ≠ altura de célula).
  - Gutter/espaçamento entre células.
  - Offset de origem do grid; mostrar/ocultar linhas; opacidade das linhas.
  - Arquivos: [src/scene/grid.ts](src/scene/grid.ts), [src/render/renderer.ts](src/render/renderer.ts)

## 2b. Escala multi-célula (estilo noise)

- [ ] 🔴 **SVG ocupando vários quadrantes (4 / 8 / 16 células)** — função extra
  que distribui escalas diferentes pelo grid: alguns SVGs ocupam 1 célula, outros
  um bloco 2×2 (4), 2×4 (8), 4×4 (16), etc., de forma randômica/controlada (campo
  tipo noise para decidir o tamanho por região).
  - Overlay que mostra a **divisão da tela** em blocos (preview das fusões de célula).
  - Modelo: instância passa a ter um "span" (largura×altura em células) e ocupa as
    células cobertas (resolver colisões/ocupação). Distribuição por noise/peso.
  - Arquivos: [src/scene/types.ts](src/scene/types.ts) (span), [src/features/placement.ts](src/features/placement.ts),
    [src/render/renderer.ts](src/render/renderer.ts) (tamanho + overlay de blocos)

## 3. Ferramentas de desenho

- [ ] 🔴 **Controles finos de desenhar e apagar** — pincel com raio (NxN células),
  densidade do traço, modo "só preencher vazias" vs "sobrescrever", preview/ghost
  da célula sob o cursor, apagar por filtro (por asset / por cor).
  - Arquivos: [src/tools/tools.ts](src/tools/tools.ts)
- [ ] ⚪ **Rotação randômica de 90°** — opção para que cada SVG colocado receba
  uma rotação aleatória entre 0/90/180/270°.
  - Onde: `buildInstance` define hoje `rotation: 0`. Adicionar flag no estado
    (ex.: `randomQuarterTurns: boolean`) e sortear com o seed da célula.
  - Arquivos: [src/features/placement.ts](src/features/placement.ts), [src/scene/types.ts](src/scene/types.ts)

## 4. Animação

> **Leva 1 concluída (Phase 5 + overhaul):** ciclo de vida enter→hold→exit
> (fade/scale/pop/rotate), ordem de revelação (linear/radial/sequencial/random),
> playback (loop/ping-pong/once), spread/durações e idle (spin/pulse/bob/sway/orbit).
> Arquivos: [src/anim/animations.ts](src/anim/animations.ts), [src/anim/order.ts](src/anim/order.ts), [src/ui/animPanel.ts](src/ui/animPanel.ts)

- [x] 🔴 **Ferramenta de desenhar a ordem (START → FINISH)** — _Leva 2 concluída._
  Ferramenta **🧭 Order** (tecla P): desenha um caminho na tela; os SVGs aparecem
  na ordem ao longo dele (projeção por comprimento de arco → `o` da instância).
  Linha tracejada com rótulos **START**/**FINISH**; desenhar troca a ordem p/ `free`.
  - Arquivos: [src/tools/tools.ts](src/tools/tools.ts), [src/anim/order.ts](src/anim/order.ts), [src/render/renderer.ts](src/render/renderer.ts)
  - Refinamentos futuros: editar/limpar caminho, snap, suavização, e decidir o que
    fazer com células muito longe da linha (hoje pegam a projeção mais próxima).
- [ ] 🟡 **Estilo "draw" / wipe (desenho)** — enter/exit por traço (stroke-dashoffset)
  ou wipe/clip que "desenha" o SVG aparecendo. Hoje temos fade/scale/pop/rotate.
  - True line-draw é difícil com `<use>`/`<symbol>` (precisa de pathLength por path);
    avaliar clip-reveal como aproximação.
  - Arquivos: [src/anim/animations.ts](src/anim/animations.ts), [src/render/renderer.ts](src/render/renderer.ts)
- [ ] 🟡 **Gatilho / trigger** — "algo que se liga": disparar a animação por evento
  (hover, clique, ao entrar na viewport) além do Play global.
- [ ] ⚪ **Presets de animação salvos + combinar animações por instância.**
- [ ] 🟡 **Animar a máscara no tempo** — mover o offset do noise por `t` para uma
  máscara "viva" (revela/apaga células progressivamente).
  - Arquivos: [src/features/noise.ts](src/features/noise.ts), [src/ui/controls.ts](src/ui/controls.ts)

## 5. Cor

- [ ] 🟡 **Cor de fundo + cor dos SVGs independentes** — controlar a cor de fundo
  do canvas e a cor dos SVGs separadamente, com modos:
  - SVG sempre da paleta ativa (atual);
  - SVG sempre uma cor fixa;
  - fundo fixo / fundo da paleta / fundo transparente (importa no export).
  - Arquivos: [src/ui/sidebar.ts](src/ui/sidebar.ts), [src/render/renderer.ts](src/render/renderer.ts), [src/scene/types.ts](src/scene/types.ts)

## 6. Áudio

- [ ] ⚪ **Adicionar som** — feedback sonoro (ex.: ao desenhar/apagar) e/ou som
  generativo ligado à animação. Web Audio API, com mute global.
  - Referência de abordagem: projeto irmão Grid-o-matic usa Web Audio.

## 7. Pesquisa / Direção

- [ ] ⚪ **Estudar mais ferramentas** — pesquisar referências e libs (Maxon Noise,
  ferramentas de generative art, editores de SVG/animação) para inspirar novos
  controles e fluxos. Registrar achados aqui.

## 8. Enquadramento / Export

- [ ] 🔴 **Controle de proporção (frame) para export** — definir a área que será
  exportada com presets de aspect ratio:
  - **16:9** (landscape), **1:1** (quadrado), **9:16** (stories/reels),
    **4:5** (feed vertical), **4:3** (clássico) e **forma livre** (arrastar/redimensionar).
  - Resolução de saída configurável (ex.: 1080×1080, 1920×1080…), independente
    do zoom atual da tela.
  - **Como amostrar na tela** (decidir/oferecer opções):
    - **Overlay/letterbox** — escurecer (máscara) tudo que está fora do frame,
      mostrando só a área que entra no export (tipo "safe area" de vídeo).
    - **Limitar o grid ao frame** — desenhar o grid apenas dentro do enquadramento,
      recortando a cena à área exportável.
    - Idealmente: frame reposicionável/escalável sobre o canvas infinito, com
      handles, e o export usa exatamente os bounds desse frame.
  - Liga direto com o Phase 6 (export): SVG/PNG/MP4 devem respeitar esse frame.
  - Arquivos prováveis: [src/scene/types.ts](src/scene/types.ts) (estado do frame),
    [src/render/renderer.ts](src/render/renderer.ts) (overlay/recorte),
    `src/export/` (a criar no Phase 6).

## 9. Imagem / vídeo como fonte (halftone & dithering)

- [ ] 🔴 **Upload de imagem/vídeo como fonte de distribuição dos SVGs** — usar uma
  mídia (imagem estática **ou** vídeo) como campo de entrada, igual a máscara de
  noise, mas amostrando a mídia por célula.
  - Por célula: amostrar luminância/cor da imagem → decide presença, escala,
    cor e/ou escolha do SVG (análogo ao `sampleMask`, trocando o noise pela mídia).
  - **Vídeo** = fonte animada: reamostrar por frame (liga com a animação/`t` e o
    export frame-a-frame do Phase 6).
  - Amostragem via `<canvas>`/`OffscreenCanvas` (`drawImage` + `getImageData`)
    mapeando célula → pixel.
  - Arquivos prováveis: `src/features/` (fonte de mídia), [src/features/placement.ts](src/features/placement.ts),
    [src/scene/types.ts](src/scene/types.ts).
- [ ] 🔴 **Dithering / halftone com os SVGs** — preencher a imagem usando os SVGs
  disponíveis como "pontos":
  - **Halftone**: escala/densidade do SVG segue a luminância (claro = pequeno/esparso,
    escuro = grande/denso); opção de ângulo de trama e por canal (CMYK).
  - **Dithering**: ordered (Bayer) ou error-diffusion (Floyd–Steinberg) decidindo
    on/off (ou qual SVG) por célula a partir da imagem.
  - Reaproveita a biblioteca de SVGs e a paleta (cor por região da imagem).
- [ ] 🟡 **Overlay de preview da fonte** — mostrar a imagem/vídeo por baixo/por cima
  do grid (com opacidade) como referência enquanto distribui; toggle on/off, igual
  ao preview da máscara.
  - Arquivos prováveis: [src/render/renderer.ts](src/render/renderer.ts), [src/ui/controls.ts](src/ui/controls.ts).

---

## Ideias soltas (parking lot)

- [ ] Salvar/carregar projetos (estado serializável → JSON / IndexedDB).
- [ ] Presets compartilháveis via URL (seed + parâmetros).
- [ ] Atalhos de teclado adicionais e painel de ajuda.
- [ ] Performance: virtualização e benchmark com muitos SVGs.
