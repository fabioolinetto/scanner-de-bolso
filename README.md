# Scanner de Bolso

App para fotografar documentos: acha as bordas sozinho, endireita, limpa a imagem e junta as páginas em PDF ou JPG. Os documentos ficam guardados no próprio celular e só são apagados quando você manda excluir.

## Android (APK)

A cada atualização enviada para a branch `main`, o GitHub monta o APK sozinho.

1. Abra a aba **Releases** deste repositório no celular.
2. Baixe o arquivo **ScannerDeBolso.apk** da versão mais nova.
3. Abra o arquivo e toque em **Instalar**. Na primeira vez, o Android pede para permitir a instalação pelo navegador ou pelo app Arquivos.

Para atualizar, instale o APK novo por cima: os documentos guardados continuam lá.

## iPhone

O iPhone usa a versão web instalável, publicada pelo GitHub Pages:

1. Abra o link do site (aba **Settings › Pages** deste repositório) no **Safari**.
2. Toque em **Compartilhar** › **Adicionar à Tela de Início**.

Ela abre com o ícone do app, funciona sem internet e guarda os documentos no próprio iPhone.

Um app de iPhone instalado pela App Store exige conta de desenvolvedor Apple (US$ 99/ano) e um Mac. O projeto já está pronto para isso: no Mac, rode `npm ci`, `npx cap add ios` e `npx cap open ios`.

## Estrutura

- `www/`: o app (HTML, CSS e JavaScript, sem etapa de build)
  - `js/detect.js`: detecção automática das bordas
  - `js/imaging.js`: correção de perspectiva e filtros
  - `js/store.js`: armazenamento no aparelho
  - `js/app.js`: telas e ações
- `android/`: projeto Android (Capacitor)
- `assets/make_icons.py`: gera o ícone em todos os tamanhos
- `.github/workflows/`: geração do APK e publicação da versão web

## Chave de assinatura

O APK é assinado com uma chave guardada nos secrets do repositório (`KEYSTORE_BASE64` e `KEYSTORE_PASSWORD`, em **Settings › Secrets and variables › Actions**). Ela não fica no código. Guarde também uma cópia fora do GitHub: sem ela, uma versão nova não instala por cima da antiga.
