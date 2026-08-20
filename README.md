# Cortes — MVP local-first

MVP web para criar cortes curtos sem servidor de renderização.

## O que já funciona

- upload de vídeo local/autorizado;
- preview do arquivo;
- seleção de início e fim;
- saída vertical 9:16 ou formato original;
- duas qualidades de exportação;
- transcrição local opcional com Whisper via Transformers.js;
- geração de `.SRT`;
- tentativa de legenda queimada no MP4 com fallback para `.SRT` separado;
- renderização MP4 no navegador usando FFmpeg.wasm;
- sugestão local de título, descrição e hashtags a partir da transcrição;
- download do vídeo final;
- interface responsiva e fluxo em quatro etapas.

## Limites intencionais desta versão

- não baixa vídeos automaticamente de YouTube/TikTok;
- não publica automaticamente nas plataformas;
- não promete prever viralização;
- arquivos grandes podem consumir muita memória;
- Whisper local baixa o modelo na primeira utilização;
- WebGPU acelera transcrição quando disponível; caso contrário, usa WASM;
- suporte a legenda queimada depende dos filtros disponíveis no build do FFmpeg.wasm e pode cair para o `.SRT` separado.

## Rodar localmente

```bash
npm install
npm run dev
```

## Build de produção

```bash
npm install
npm run build
```

O diretório gerado será `dist/`.

## Cloudflare Pages

Configuração sugerida:

- Framework preset: **Vite**
- Build command: `npm run build`
- Build output directory: `dist`
- Node.js: versão compatível com Vite 8 (recomenda-se Node 22 atual)

Não são necessárias variáveis de ambiente para o fluxo principal.

## Arquitetura

```text
Arquivo do usuário
    ↓
Navegador
    ├── FFmpeg.wasm → corte / crop / encode
    ├── Transformers.js + Whisper → transcrição
    └── SRT / metadata local
    ↓
Preview
    ↓
Download MP4
```

## Uso responsável

O MVP foi desenhado para trabalhar com conteúdo próprio, licenciado ou autorizado. A aplicação não inclui rotinas de download indiscriminado de conteúdo de terceiros.

> `public/robots.txt` bloqueia indexação enquanto o projeto ainda for um protótipo. Remova essa regra quando decidir publicar o produto para descoberta pública.
