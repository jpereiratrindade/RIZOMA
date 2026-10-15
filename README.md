# RIZOMA — Imagem primeiro

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
**Versão operacional:** `0.2.0` · **Estado:** piloto local com autenticação institucional e acervo isolado por usuário  
**Licença:** GNU General Public License v3.0 ([GPLv3](LICENSE))  
**Repositório:** [github.com/jpereiratrindade/RIZOMA](https://github.com/jpereiratrindade/RIZOMA)  
**Princípio:** *Sempre pronto. Sempre incompleto.*

Aplicação autônoma, inspirada na linguagem visual do **TRAMA** e **TRAMA-RS**. O objeto primário é o **arquivo de imagem**. Projetos, protocolos, equipamentos e unidades experimentais entrarão no futuro como metadados e contexto, sem subordinar a identidade da imagem.

## O que já funciona

- Servidor HTTP e núcleo de ingestão em **C++26** (compila em modo `-std=c++2c` no GCC 14 da demonstração).
- Interface web responsiva, sem dependência de JavaScript de terceiros.
- Recebimento de PNG, JPEG e TIFF com limites de **12 MiB e 12 megapixels por arquivo**; validação de formato pelo conteúdo e decodificação efetiva.
- Registro de nome, identificador opcional de amostra e data opcional de captura; altura/largura, tipo, bytes, SHA-256, data/hora UTC e versão da preparação.
- Arquivos originais em armazenamento privado endereçado por hash; original nunca sobrescrito pela interface. SHA-256 é identificador do conteúdo, não comprovação de autoria ou garantia de retenção.
- Prévia redimensionada e derivado em tons de cinza, ambos PNG e separados do original. São arquivos de **inspeção**, não dados científicos para medição.
- Sinalização operacional de brilho médio da prévia: `REVIEW`, `LOW_LIGHT` e `HIGH_LIGHT`. O baseline experimental pode sugerir regiões `ROOT`/`UNKNOWN` para revisão; não há classificação radicular nem teste automatizado validado cientificamente.
- SQLite com WAL, registro de evento de ingestão, consultas, filtros, inspeção visual e exportação de manifesto CSV.
- Fluxo experimental integrado de regiões candidatas, sugestão `ROOT`/`UNKNOWN` e revisão humana persistente (`ROOT`, `MATRIX`, `ARTIFACT`, `UNKNOWN`) com histórico append-only.
- Teste automatizado de HTTP, persistência após reinício, verificação de hash, rejeição de duplicatas, imagem inválida e suporte a PNG, JPEG e TIFF.

## Executar (Fedora / Toolbox)

Pacotes correspondentes em Fedora:

```bash
sudo dnf install -y gcc-c++ cmake boost-devel sqlite-devel openssl-devel libpng-devel libjpeg-turbo-devel libtiff-devel python3
```


Na pasta do projeto:

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure

# 1. Apenas máquina local (padrão seguro loopback):
./build/rizoma-server --host 127.0.0.1 --data-dir ./var --web-dir ./web --port 8089

# 2. Acesso via rede local (acessível por outros dispositivos na LAN do laboratório):
./build/rizoma-server --host 0.0.0.0 --data-dir ./var --web-dir ./web --port 8089
# Ou usando o script run.sh:
RIZOMA_HOST=0.0.0.0 ./run.sh
```

- **Acesso local:** [http://127.0.0.1:8089](http://127.0.0.1:8089)
- **Acesso via rede local:** `http://<IP_DA_MAQUINA>:8089` (ex.: `http://10.163.80.176:8089`)

A interface não envia arquivos a serviços externos. Por padrão seguro, o servidor se liga exclusivamente a `127.0.0.1`. Ao utilizar `--host 0.0.0.0`, o serviço fica disponível para computadores e estações conectadas à mesma sub-rede local.

Para preparar a área privada de produção, crie diretório de armazenamento em disco confiável e mantenha `var/` fora do Git. O código, os testes e a interface são versionados; imagens reais, banco de dados e derivados não devem entrar no repositório público.

## Autenticação e Registro Institucional (@embrapa.br)

O RIZOMA implementa autenticação institucional baseada em **chave temporária de acesso (OTP de uso único)** enviada por e-mail:
- **Restrição estrita de domínio:** aceita exclusivamente endereços institucionais `@embrapa.br`. Tentativas com qualquer outro domínio são rejeitadas.
- **Registro simplificado:** na primeira solicitação válida, o perfil de usuário é provisionado automaticamente no banco SQLite local.
- **Chave de 6 dígitos:** gerada de forma criptograficamente segura via OpenSSL, com validade de 15 minutos e consumo único.
- **Sessão persistente:** após validação da chave, é emitida sessão (token de 64 caracteres) com validade de 7 dias persistida no banco, enviada via cookie `rizoma_session` ou cabeçalho `Authorization: Bearer <token>`.
- **Isolamento estrito de acervo:** cada usuário autenticado acessa exclusivamente seu próprio acervo de imagens, registros de integridade, arquivos originais/derivados e manifesto CSV de exportação. Requisições entre usuários diferentes são bloqueadas com 404 (evitando enumeração).
- **Rastreabilidade de operador:** toda imagem ingerida passa a ser vinculada ao e-mail institucional e ao ID do operador no acervo e no log de eventos.

### Configuração de Envio de E-mail (SMTP)

Variáveis de ambiente opcionais para disparo de e-mail corporativo:
- `RIZOMA_SMTP_HOST`: Host do servidor SMTP (ex.: `smtp.embrapa.br`). Se não informado, o servidor opera em modo piloto/desenvolvimento local, exibindo a chave no terminal e na interface de teste.
- `RIZOMA_SMTP_PORT`: Porta SMTP (padrão: `587`).
- `RIZOMA_SMTP_USER` / `RIZOMA_SMTP_PASS`: Credenciais opcionais de autenticação SMTP.
- `RIZOMA_SMTP_FROM`: Remetente das mensagens (padrão: `rizoma@embrapa.br`).

## API do primeiro corte

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/v1/health` | Saúde do serviço |
| `POST` | `/api/v1/auth/request-code` | Solicita chave de acesso para e-mail `@embrapa.br` |
| `POST` | `/api/v1/auth/verify-code` | Valida código de 6 dígitos e inicia sessão |
| `GET` | `/api/v1/auth/me` | Consulta dados da sessão atual |
| `POST` | `/api/v1/auth/logout` | Encerra a sessão ativa |
| `GET` | `/api/v1/images` | Catálogo de imagens do usuário autenticado |
| `POST` | `/api/v1/images?...` | Upload de imagem vinculado ao usuário (requer autenticação) |
| `GET` | `/api/v1/images/{id}` | Metadados da imagem do usuário autenticado |
| `GET` | `/api/v1/images/{id}/original` | Arquivo original preservado do usuário autenticado |
| `GET` | `/api/v1/images/{id}/preview` | Prévia PNG para inspeção do usuário autenticado |
| `GET` | `/api/v1/images/{id}/grayscale` | Derivado PNG em tons de cinza do usuário autenticado |
| `GET` | `/api/v1/export/manifest.csv` | Manifesto de metadados do acervo do usuário (requer autenticação) |
| `POST/GET` | `/api/v1/images/{id}/analysis` | Executa ou recupera o baseline experimental e suas regiões |
| `POST/GET` | `/api/v1/analysis-regions/{id}/reviews` | Registra ou recupera o histórico humano da região |

Parâmetros opcionais de upload: `filename`, `sample_id`, `capture_date` (ISO `YYYY-MM-DD`). Exemplo autenticado:

```bash
# 1. Solicitar chave:
curl -fsS -X POST 'http://127.0.0.1:8089/api/v1/auth/request-code' \
  -H 'Content-Type: application/json' \
  -d '{"email":"pesquisador@embrapa.br"}'

# 2. Validar chave (código recebido no e-mail ou console local):
curl -fsS -c cookies.txt -X POST 'http://127.0.0.1:8089/api/v1/auth/verify-code' \
  -H 'Content-Type: application/json' \
  -d '{"email":"pesquisador@embrapa.br","code":"123456"}'

# 3. Enviar imagem usando a sessão autenticada:
curl -fsS -b cookies.txt -X POST 'http://127.0.0.1:8089/api/v1/images?filename=amostra.png&sample_id=PARCELA-01&capture_date=2026-10-14' \
  -H 'Content-Type: application/octet-stream' -H 'X-Rizoma-Client: web-v0.2.0' \
  --data-binary @amostra.png
```

## Separação fundamental

```text
Arquivo recebido (original, SHA-256, privado)
     │
     ├── metadados técnicos ──► SQLite WAL + eventos
     │
     └── preparação v0.2.0 ──► prévia + tons de cinza
                                        │
                                        └─► interface de inspeção

[ Baseline experimental: regiões candidatas → hipótese → revisão humana persistente ]
```

**Nenhum resultado radicular validado ou medida biológica é produzido.** As regiões são hipóteses experimentais para revisão humana; um retângulo `ROOT` significa apenas que o pesquisador indicou que a região contém possível raiz. A dimensão da imagem em pixels não equivale a uma medida física. A escala e a orientação EXIF não são aplicadas às prévias; o original mantém os bytes originais.

## Limitações intencionais e exigências antes de uso multiusuário

1. **Rede e exposição controlada.** O padrão seguro de execução é `127.0.0.1` (loopback). A opção `--host 0.0.0.0` permite acesso em rede local restrita (laboratório/bancada), mas não deve ser exposta à internet aberta: faltam autenticação de usuários, autorização granular por projeto, HTTPS obrigatório e controle de quotas.
2. **Upload buffered.** Cada requisição é recebida em memória até 12 MiB e a transformação ocorre sincronamente. A próxima etapa deverá oferecer ingestão em fluxo, staging persistente, verificação e filas para maiores volumes.
3. **Formatos e ciência.** Suporte nativo a PNG, JPEG e TIFF (RGB/escala de cinza/paleta) implementado; formatos multicanal avançados, profundidades superiores a 8 bits no pipeline científico, calibração métrica e metadados instrumentais específicos (tags científicas de scanner/EXIF) serão aprofundados na etapa de caracterização.
4. **Retenção.** Diretórios privados e WAL não bastam: backups verificados, política de retenção e recuperação de arquivos órfãos precisam ser implementados.
5. **Integridade.** Sem re-verificação periódica do hash durante a leitura, monitoramento de disco, assinatura de proveniência ou imutabilidade no nível do sistema de arquivos. SHA-256 é calculado na entrada e gravado no catálogo.
6. **Qualidade.** O brilho é uma triagem operacional sobre a prévia, não uma classificação científica da imagem. Resampling por vizinho mais próximo é deliberadamente apenas para visualização.
7. **Teste visual.** Testes HTTP/CTest passaram no ambiente de geração; a execução de navegador automatizado foi bloqueada pelo ambiente. Fazer teste manual de UI e acessibilidade no ambiente-alvo.
8. **Compatibilidade.** O código utiliza apenas recursos de C++ disponíveis no compilador testado sob o modo C++26; não pressupõe suporte integral a todas as novidades do padrão.

## Planejamento

Consultar [`docs/RIZOMA-IMG-FOUNDATION-001.md`](docs/RIZOMA-IMG-FOUNDATION-001.md): objeto, invariantes, contratos, etapas, CRIVO, segurança e critérios de aceite.

### Referências visuais

- [TRAMA](https://github.com/jpereiratrindade/TRAMA) — `web/src/style.css`.
- [TRAMA-RS](https://github.com/jpereiratrindade/TRAMA-RS) — `web/index.html`.

## Licença

Este projeto é software livre licenciado sob a [GNU General Public License v3.0 (GPLv3)](LICENSE).
