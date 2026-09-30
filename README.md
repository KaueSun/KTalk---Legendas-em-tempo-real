# KTalk

KTalk é um aplicativo para Windows que cria legendas ao vivo a partir do áudio do computador ou do microfone. Ele também traduz falas em inglês para português brasileiro, sem enviar o áudio para serviços externos.

## O que ele faz

- Captura o áudio de vídeos, jogos, chamadas e microfone.
- Mostra legendas enquanto a pessoa fala.
- Traduz inglês para português brasileiro.
- Exibe uma janela flutuante sobre outros aplicativos.
- Mantém um histórico da sessão e permite exportar em TXT ou SRT.
- Permite testar o sinal, escolher o dispositivo e ajustar a sensibilidade da detecção de voz.

## Como usar

Abra `KTalk.cmd` e siga estes passos:

1. Escolha **Áudio do PC**, **Microfone** ou **Ambos**.
2. Clique em **Testar áudio** para conferir se o dispositivo certo está recebendo som.
3. Mantenha **Traduzir EN → PT-BR** para traduzir falas em inglês, ou escolha **Só transcrever** para mostrar o idioma original.
4. Clique em **Iniciar tradução**.
5. Ative a legenda flutuante caso queira acompanhar o texto enquanto usa outro programa.

| Atalho | Ação |
| --- | --- |
| Ctrl + Shift + Espaço | Iniciar ou parar as legendas |
| Ctrl + Shift + O | Mostrar ou ocultar a legenda flutuante |

## Instalação

Para preparar o projeto em outro computador:

```powershell
node scripts/bootstrap-npm.mjs install
node scripts/bootstrap-npm.mjs run setup:electron
node scripts/setup-python.mjs
node scripts/bootstrap-npm.mjs run build
.\KTalk.cmd
```

É necessário ter Node.js 22.12 ou superior, Python 3.12 e `uv` instalados. Na primeira execução, o aplicativo baixa os modelos necessários. Depois que eles forem preparados, o reconhecimento e a tradução funcionam localmente.

## Observações

- A legenda começa a aparecer durante a fala e pode ser ajustada quando chega mais contexto.
- O modelo **Tiny** é o mais rápido. Os modelos **Base** e **Small** podem melhorar a precisão, mas exigem mais do computador.
- Música, ruído forte, falas sobrepostas e áudio de baixa qualidade podem afetar o resultado.
- O histórico fica apenas durante a execução. Exporte antes de fechar o programa.
- Para capturar sistema e microfone ao mesmo tempo, o uso de fones ajuda a evitar áudio duplicado.

## Desenvolvimento

```powershell
node scripts/check.mjs
node scripts/smoke-desktop.mjs
.venv\Scripts\python.exe scripts/check-devices.py
```

O projeto usa Electron e React na interface, com Python para captura, reconhecimento e tradução local.
