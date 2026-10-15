# KTalk

KTalk é um aplicativo para Windows que cria legendas ao vivo a partir do áudio do computador ou do microfone. Ele também traduz falas em inglês para português brasileiro, sem enviar o áudio para serviços externos.

## O que ele faz

- Captura o áudio de vídeos, jogos, chamadas e microfone.
- Mostra legendas enquanto a pessoa fala.
- Traduz inglês para português brasileiro.
- Exibe uma janela flutuante sobre outros aplicativos.
- Salva sessões no computador, quando você ativa essa opção, e exporta em TXT ou SRT.
- Permite nomear sessões, excluir conversas e definir por quanto tempo guardar o histórico.
- Permite testar o sinal, escolher o dispositivo e ajustar a sensibilidade da detecção de voz.

## Como usar

Abra o KTalk e siga estes passos:

1. Escolha **Áudio do PC**, **Microfone** ou **Ambos**.
2. Clique em **Testar áudio** para conferir se o dispositivo certo está recebendo som.
3. Mantenha **Traduzir EN → PT-BR** para traduzir falas em inglês, ou escolha **Só transcrever** para mostrar o idioma original.
4. Clique em **Iniciar tradução**.
5. Ative a legenda flutuante caso queira acompanhar o texto enquanto usa outro programa.

| Atalho                | Ação                                   |
| --------------------- | -------------------------------------- |
| Ctrl + Shift + Espaço | Iniciar ou parar as legendas           |
| Ctrl + Shift + O      | Mostrar ou ocultar a legenda flutuante |

## Instalação

No Windows 10 ou 11 de 64 bits, execute `KTalk-Setup-0.3.1.exe`. O instalador inclui o motor de áudio; não é preciso instalar Python ou Node.js para usar o aplicativo.

Na primeira sessão, o KTalk baixa e prepara os modelos de reconhecimento e tradução. Essa etapa precisa de internet e pode levar alguns minutos. Depois, os modelos já preparados funcionam offline. Escolher outro modelo de reconhecimento pode exigir um novo download.

A tela mostra qual etapa está em andamento: reconhecimento, tradução ou abertura dos dispositivos. Você pode cancelar a preparação e tentar novamente depois. Um teste de áudio abre apenas os dispositivos, sem baixar modelos.

O instalador ainda não possui assinatura digital. A versão 0.3 está em validação para uso diário; a compatibilidade com diferentes dispositivos de áudio ainda precisa de testes em mais computadores.

## Histórico e privacidade

O áudio é processado neste computador e não é gravado. Em **Configurações → Histórico e privacidade**, você pode ativar o armazenamento das transcrições. O arquivo é criptografado com a proteção da sua conta do Windows; isso não impede o acesso por outros programas executados nessa mesma conta.

Você pode guardar sessões por 7, 30 ou 90 dias, até o limite de 2.000 trechos confirmados. A retenção é aplicada ao abrir e salvar o histórico. Desativar o armazenamento apaga a cópia salva. Os arquivos TXT e SRT exportados ficam sob seu controle e não são criptografados pelo KTalk.

Se o motor de voz falhar, o aplicativo tenta reconectar e preserva os trechos confirmados. A captura só volta quando você inicia uma nova sessão. O diagnóstico exportado nas configurações não inclui áudio, transcrições ou nomes dos dispositivos.

Se houver uma falha ao salvar o histórico durante o fechamento, o KTalk permite manter a janela aberta para exportar, tentar salvar novamente ou fechar sem salvar. A opção padrão mantém a transcrição disponível.

## Desenvolvimento

Requisitos: Windows de 64 bits, Node.js 22.12 ou superior e [uv](https://docs.astral.sh/uv/). O comando de preparação instala uma cópia isolada do Python 3.12.

```powershell
node scripts/bootstrap-npm.mjs install
node scripts/bootstrap-npm.mjs run setup:electron
node scripts/setup-python.mjs
node scripts/bootstrap-npm.mjs run build
.\KTalk.cmd
```

Para conferir o projeto:

```powershell
node scripts/check.mjs
node scripts/bootstrap-npm.mjs run format:check
node scripts/smoke-desktop.mjs
.venv\Scripts\python.exe scripts/check-devices.py
```

Para gerar o instalador:

```powershell
uv pip install --python .venv/Scripts/python.exe -r backend/requirements-build.txt
node scripts/bootstrap-npm.mjs run package:win
```

O resultado fica em `release/`. O aplicativo empacotado também pode ser testado com `node scripts/smoke-desktop.mjs --packaged`. O teste com captura real usa `--audio` e precisa do WAV de teste em `artifacts/speech-test.wav` e dos modelos locais preparados.

Com os modelos e o pacote original de tradução no cache de desenvolvimento, `node scripts/check-bundle.mjs` verifica a preparação do tradutor pelo motor empacotado, sem depender de Python externo ou internet.

O projeto usa Electron, React e TypeScript na interface. A captura usa WASAPI, a detecção de fala usa Silero VAD e o reconhecimento usa faster-whisper. A tradução de inglês para PT-BR usa OPUS-MT com CTranslate2. O processamento atual é feito na CPU.

## Observações

- A legenda começa a aparecer durante a fala e pode ser ajustada quando chega mais contexto. Há atraso de processamento, que depende do modelo e do computador.
- O modelo **Tiny** é o mais rápido. Os modelos **Base** e **Small** podem melhorar a precisão, mas exigem mais do computador.
- Música, ruído forte, falas sobrepostas e áudio de baixa qualidade podem afetar o resultado.
- Sem o armazenamento ativado, o histórico fica apenas durante a execução. Exporte antes de fechar o programa.
- Para capturar sistema e microfone ao mesmo tempo, o uso de fones ajuda a evitar áudio duplicado.
- A legenda flutuante pode não aparecer sobre jogos em tela cheia exclusiva. Use o modo janela sem bordas nesses casos.
