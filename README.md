# RIZOMA — Imagem primeiro

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
**Versão operacional:** `0.2.0` · **Estado:** piloto local (sem autenticação nem publicação externa)  
**Licença:** GNU General Public License v3.0 ([GPLv3](LICENSE))  
**Repositório:** [github.com/jpereiratrindade/RIZOMA](https://github.com/jpereiratrindade/RIZOMA)  
**Princípio:** *Sempre pronto. Sempre incompleto.*

Aplicação autônoma, inspirada na linguagem visual do **TRAMA** e **TRAMA-RS**. O objeto primário é o **arquivo de imagem**. Projetos, protocolos, equipamentos e unidades experimentais entrarão no futuro como metadados e contexto, sem subordinar a identidade da imagem.

## O que já funciona

- Servidor HTTP e núcleo de ingestão em **C++26** (compila em modo `-std=c++2c` no GCC 14 da demonstração).
- Interface web responsiva, sem dependência de JavaScript de terceiros.
- Recebimento de PNG e JPEG com limites de **12 MiB e 12 megapixels por arquivo**; validação de formato pelo conteúdo e decodificação efetiva.
- Registro de nome, identificador opcional de amostra e data opcional de captura; altura/largura, tipo, bytes, SHA-256, data/hora UTC e versão da preparação.
- Arquivos originais em armazenamento privado endereçado por hash; original nunca sobrescrito pela interface. SHA-256 é identificador do conteúdo, não comprovação de autoria ou garantia de retenção.
- Prévia redimensionada e derivado em tons de cinza, ambos PNG e separados do original. São arquivos de **inspeção**, não dados científicos para medição.
- Sinalização operacional de brilho médio da prévia: `REVIEW`, `LOW_LIGHT` e `HIGH_LIGHT`. Não há classificação de raízes nem teste automatizado de qualidade validado cientificamente.
- SQLite com WAL, registro de evento de ingestão, consultas, filtros, inspeção visual e exportação de manifesto CSV.
- Teste automatizado de HTTP, persistência após reinício, verificação de hash, rejeição de duplicatas, imagem inválida e acesso sem cabeçalho de aplicação.

## Executar (Fedora / Toolbox)

Pacotes correspondentes em Fedora:

```bash
sudo dnf install -y gcc-c++ cmake boost-devel sqlite-devel openssl-devel libpng-devel libjpeg-turbo-devel python3
```

Na pasta do projeto:

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
./build/rizoma-server --data-dir ./var --web-dir ./web --port 8089
```

Abrir: **http://127.0.0.1:8089**. A interface não envia arquivos a serviços externos. O servidor está **deliberadamente limitado à interface loopback** `127.0.0.1`.

Para preparar a área privada de produção, crie diretório de armazenamento em disco confiável e mantenha `var/` fora do Git. O código, os testes e a interface são versionados; imagens reais, banco de dados e derivados não devem entrar no repositório público.

## API do primeiro corte

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/v1/health` | Saúde do serviço |
| `GET` | `/api/v1/images` | Catálogo local, até 500 registros na primeira versão |
| `POST` | `/api/v1/images?...` | Upload do binário, `application/octet-stream`, cabeçalho `X-Rizoma-Client: web-v0.2.0` |
| `GET` | `/api/v1/images/{id}` | Metadados da imagem |
| `GET` | `/api/v1/images/{id}/original` | Arquivo original preservado |
| `GET` | `/api/v1/images/{id}/preview` | Prévia PNG para inspeção |
| `GET` | `/api/v1/images/{id}/grayscale` | Derivado PNG em tons de cinza |
| `GET` | `/api/v1/export/manifest.csv` | Manifesto de metadados |

Parâmetros opcionais de upload: `filename`, `sample_id`, `capture_date` (ISO `YYYY-MM-DD`). Exemplo:

```bash
curl -fsS -X POST 'http://127.0.0.1:8089/api/v1/images?filename=amostra.png&sample_id=PARCELA-01&capture_date=2026-10-14' \
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

[ Em momento futuro: pipelines de segmentação, análise e validação ]
```

**Nenhum resultado radicular é produzido.** `scientific_status` é sempre `NOT_ANALYZED`. A dimensão da imagem em pixels não equivale a uma medida física. A escala e a orientação EXIF não são aplicadas às prévias; o original mantém os bytes originais.

## Limitações intencionais e exigências antes de uso multiusuário

1. **Somente loopback.** Não mudar o código para `0.0.0.0` nem expor diretamente na rede: faltam autenticação, autorização por usuário/projeto, HTTPS, políticas de compartilhamento, quotas e controle de abuso.
2. **Upload buffered.** Cada requisição é recebida em memória até 12 MiB e a transformação ocorre sincronamente. A próxima etapa deverá oferecer ingestão em fluxo, staging persistente, verificação e filas para maiores volumes.
3. **Formatos e ciência.** TIFF, multicanal, profundidades superiores a 8 bits, ICC/EXIF e metadados instrumentais específicos ainda não estão tratados na preparação. A aquisição deve ser caracterizada antes de escolher um pipeline científico.
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

