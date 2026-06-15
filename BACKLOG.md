# Backlog — SVG Grid Generator

Controle de alterações e ideias futuras. Itens marcados `[ ]` estão pendentes,
`[x]` concluídos. Ver também o status das fases em [README.md](README.md).

> Convenção: cada item tem uma nota curta com a intenção e, quando útil, onde
> mexer no código. Prioridade sugerida: 🔴 alta · 🟡 média · ⚪ baixa.

---

## 1. Interface (UI/UX)

- [~] 🟡 **Revisão do layout da interface** — _grande parte feita._
  Feito: tema **creme + accent dourado** (igual grid.leit.in), **fundo de pontos**,
  e a **UI flutuante**: modos no topo (Draw/Compose/Animate/Export), toolbox por modo
  embaixo, **context menus** acima da toolbox (Shapes, Colors, Noise, Animate, Export),
  status (cell/placed + undo/redo/clear) no canto inf. esquerdo e zoom no direito.
  Falta: responsividade fina, tema claro/escuro, e refino visual.
  - Arquivos: [index.html](index.html), [src/ui/shell.ts](src/ui/shell.ts), [src/ui/](src/ui/), [src/ui/styles/app.css](src/ui/styles/app.css)
- [x] 🔴 **Agrupar as funções por tipo** — feito via os 4 modos + context menus
  compartilhados (Shapes/Colors). Refinamentos futuros: subgrupos dentro dos modos.
- [ ] 🟡 **Blur nos menus** — backdrop-filter (vidro/glass) por trás das caixas
  flutuantes (toolbox, context, etc.). Arquivo: [src/ui/styles/app.css](src/ui/styles/app.css) (`.float`/`#context`).
- [ ] 🟡 **Todos os combobox iguais ao "Size cell"** — trocar os `<select>` nativos
  (Animation, Export…) pelo dropdown custom estilo pílula + lista flutuante (igual
  ao seletor de Size). Extrair um componente reutilizável a partir de `sizeDropdown`.
  - Arquivos: [src/ui/shell.ts](src/ui/shell.ts), [src/ui/animPanel.ts](src/ui/animPanel.ts), [src/ui/exportPanel.ts](src/ui/exportPanel.ts), [src/ui/styles/app.css](src/ui/styles/app.css)
- [ ] ⚪ **Status (cell/placed) sem caixa** — tirar o box/borda do canto inf. esquerdo
  (texto solto) e **remover a palavra "placed"** (deixar só `cell x,y · N`).
  - Arquivos: [src/ui/shell.ts](src/ui/shell.ts) (`buildStatus`), [src/ui/styles/app.css](src/ui/styles/app.css) (`#status`).
- [ ] 🟡 **Transições suaves** — animar a troca de **modo**, abrir/fechar **menus de
  contexto** e como o **conteúdo aparece** (fade/slide/scale, com easing). Cuidar
  para não atrapalhar performance do canvas.
  - Arquivos: [src/ui/styles/app.css](src/ui/styles/app.css), [src/ui/shell.ts](src/ui/shell.ts) (classes de estado/transição).
- [ ] 🟡 **Micro-interações de hover** — animações de hover em botões e outros itens
  (transition de cor/escala/sombra), consistentes em toda a UI.
  - Arquivos: [src/ui/styles/app.css](src/ui/styles/app.css).
- [ ] 🟡 **Cursor por estado/ferramenta** — o ponteiro do mouse muda conforme o modo
  e a função ativa (ex.: crosshair no Draw, borracha no Erase, grab/grabbing no Pan,
  cursor de caminho no Order, move/resize no frame, brush quando houver brush size).
  - Hoje o `#stage` é sempre `crosshair`. Aplicar via classe no stage conforme `tool`/`mode`.
  - Arquivos: [src/ui/shell.ts](src/ui/shell.ts) (classe no stage), [src/ui/styles/app.css](src/ui/styles/app.css).

## 2. Grid

- [ ] 🟡 **Layout do grid** — mais opções além do tamanho de célula:
  - Grid retangular (largura ≠ altura de célula).
  - Gutter/espaçamento entre células.
  - Offset de origem do grid; mostrar/ocultar linhas; opacidade das linhas.
  - Arquivos: [src/scene/grid.ts](src/scene/grid.ts), [src/render/renderer.ts](src/render/renderer.ts)
- [ ] 🟡 **Hover no grid** — destacar a célula sob o cursor (highlight) e/ou um ghost
  preview do que será colocado, atualizando ao mover o mouse.
  - Arquivos: [src/tools/tools.ts](src/tools/tools.ts) (hover já existe p/ coords), [src/render/renderer.ts](src/render/renderer.ts) (overlay de hover).

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

- [ ] 🔴 **Controles finos de desenhar e apagar** — **brush size** (raio NxN células)
  para Draw e Erase, densidade do traço, modo "só preencher vazias" vs "sobrescrever",
  preview/ghost da célula sob o cursor, apagar por filtro (por asset / por cor).
  - Arquivos: [src/tools/tools.ts](src/tools/tools.ts)
- [ ] 🔴 **Modo stencil no Noise (pincel de máscara)** — em vez de só "Apply to view",
  um **brush** que pinta/apaga a máscara de noise na tela com um **brush size**
  (revela/oculta SVGs pintando, em vez de aplicar a tela inteira).
  - Liga com o overlay de preview do noise; pintar adiciona/remove células conforme
    o valor do campo sob o pincel.
  - Arquivos: [src/tools/tools.ts](src/tools/tools.ts), [src/features/placement.ts](src/features/placement.ts) (applyMask), [src/ui/controls.ts](src/ui/controls.ts)
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

- [~] 🟡 **Cor de fundo + cor dos SVGs independentes** — _parcial._
  Feito: controle de **cor de fundo** do canvas (ao vivo) + **export transparente**
  (checkbox) no painel Export. Falta: modos de cor dos SVGs (sempre da paleta /
  sempre cor fixa) independentes do fundo.
  - Arquivos: [src/ui/exportPanel.ts](src/ui/exportPanel.ts), [src/export/svgExport.ts](src/export/svgExport.ts), [src/main.ts](src/main.ts)

## 6. Áudio

- [ ] ⚪ **Adicionar som** — feedback sonoro (ex.: ao desenhar/apagar) e/ou som
  generativo ligado à animação. Web Audio API, com mute global.
  - Referência de abordagem: projeto irmão Grid-o-matic usa Web Audio.

## 7. Pesquisa / Direção

- [ ] ⚪ **Estudar mais ferramentas** — pesquisar referências e libs (Maxon Noise,
  ferramentas de generative art, editores de SVG/animação) para inspirar novos
  controles e fluxos. Registrar achados aqui.

## 8. Enquadramento / Export

> **Phase 6a concluída:** frame em world-space com presets 16:9/1:1/9:16/4:5/4:3/free,
> resolução de saída, overlay letterbox + "Fit to view", e export **SVG** e **PNG**.
> Arquivos: [src/export/frame.ts](src/export/frame.ts), [src/export/svgExport.ts](src/export/svgExport.ts), [src/export/raster.ts](src/export/raster.ts), [src/ui/exportPanel.ts](src/ui/exportPanel.ts)

- [x] 🔴 **Controle de proporção (frame) para export** — presets + resolução +
  letterbox + Fit to view (overlay). SVG/PNG já respeitam o frame.
- [x] 🔴 **Export animado (Phase 6b)** — sequência **PNG** (.zip via JSZip) e **MP4**
  (WebCodecs H.264 + mp4-muxer), amostrando a animação pura por frame; controles de
  fps/duração + "loop length" + progresso.
  - Arquivos: [src/export/sequence.ts](src/export/sequence.ts), [src/export/video.ts](src/export/video.ts), [src/ui/exportPanel.ts](src/ui/exportPanel.ts)
  - Pendente: WebM/GIF, encode em worker (hoje no main thread), e cancelar export.
- [x] 🟡 **Frame reposicionável/escalável** — arrastar a borda (move) + handles
  (cantos = scale; laterais = esticar H/V no Free Form; aspectos fixos travam a
  proporção) + **snap to grid** (Free Form nunca corta célula). Free → "Free Form".
  - Pendente: snap exato em aspectos fixos (hoje mantém a proporção, podendo não
    alinhar à célula) e opção de "limitar o grid ao frame" (recorte) além do letterbox.
- [ ] 🟡 **Cor de fundo no export** — hoje o fundo é transparente (formas claras
  somem em fundo branco). Liga com o item 5 (cor de fundo).

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
