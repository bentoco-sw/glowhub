# GlowHub & BentoClub (PWA)

Sistema de Ponto de Venda Progressive Web App (PWA) otimizado para **Tablets e Smartphones**, pronto para hospedagem estática no **GitHub Pages** com **Persistência Híbrida** (IndexedDB + Exportação/Importação Excel/CSV/JSON + Sincronização em tempo real com **Google Sheets** via Google Apps Script).

---

## Funcionalidades Implementadas

1. **Login e Controle de Acesso (`Cadastro de Usuários.xlsx`):**
   - 12 operadores pré-carregados com busca rápida e seleção por toque.
   - **Visão de Administrador exclusiva para o cargo `Gestor` (`Carolina` e `João`)** na tela principal, apresentando o volume de vendas (`R$`, itens e share `%`) por segmento (**Glow Hub** vs **BentoClub**), por marca (**Davines**, **Keune**, **Kérastase**) e por clube de assinatura.
   - Implementa o contrato de segurança **`CTR-PWA-AUTH-WALL-01`** (casca vazia em `index.html`, máquina de estados `BOOTSTRAP -> CHECKING_SESSION -> UNAUTHENTICATED -> AUTHENTICATED`, sem ocultamento por CSS).

2. **Venda de Produtos — Glow Hub (`GlowHUB_Cadastro_Produtos.xlsx`):**
   - Identidade visual com a logomarca oficial [`assets/GlowHub-Oficial.png`](assets/GlowHub-Oficial.png) (`assets/glowhub-logo.png`).
   - Filtro pelas 3 marcas com logomarcas oficiais: **Davines** (72 itens), **Keune** (109 itens ativos) e **Kérastase** (73 itens), totalizando **254 produtos ativos** (os 3 itens Keune de `R$ 0,08` marcados com `*` são ocultados automaticamente).
   - Busca textual instantânea sem diferenciação de acentos/maiúsculas, filtro por categoria e opção de exibir apenas itens com estoque positivo.
   - **Venda permitida com estoque zero/negativo + registro automático de ajuste:** produtos zerados ou com quantidade vendida acima do saldo disponível continuam liberados para venda; ao concluir o pedido, o sistema grava automaticamente o ajuste positivo necessário em `stockAdjustments` (e sincroniza na aba `Ajustes_Estoque` do Google Sheets), mantendo o saldo resultante em `0`.

3. **Venda de Assinaturas — BentoClub (`Cadastro de Clubes.xlsx`):**
   - Seleção pelos **6 clubes** (**31 opções** no total):
     1. **Clube da Escova** (16 opções — 4 sessões, validade 35 dias)
     2. **Clube da Unha Clássica** (3 opções — Manicure, Pedicure, Manicure + Pedicure, 4 sessões, validade 35 dias)
     3. **Clube da Esmaltação em Gel** (4 opções — inclui **Manutenção de Alongamento** Acrílico e Gel/Fibra, validade 60 dias / 45 dias)
     4. **Clube da Massagem** (3 opções — 4, 6 e 12 sessões, validade 35 dias / 3 meses)
     5. **Clube da Maquiagem** (2 opções — Soft Makes e Glow Ups, 3 sessões, validade 30 dias)
     6. **Clube da Cor** (3 opções — Retoque de Raiz 1cm, 2cm e 3cm, 3 sessões, validade 90 dias)

4. **Vínculo de Cliente no 1º Item e Cadastro Rápido (`Cadastro Clientes.xlsx`):**
   - Base inicial carregada com **1.721 clientes únicos**.
   - Ao adicionar o 1º item ao carrinho, o sistema solicita a identificação do cliente. Caso o cliente da planilha esteja com celular vazio, solicita o preenchimento do celular com DDD (10 ou 11 dígitos). Caso não exista, permite **Cadastro Rápido (Nome + Celular)**.

5. **Carrinho Misto e Checkout Multi-Pagamento:**
   - Permite combinar produtos **Glow Hub** e assinaturas **BentoClub** no mesmo pedido.
   - Navegação persistente para retornar ao **Menu Principal** e abrir/fechar o carrinho a qualquer momento.
   - Formas de pagamento no Checkout: **PIX**, **Dinheiro** (com cálculo automático de troco), **Cartão de Crédito** (1x a 12x), **Cartão de Débito** e **Transferência Bancária**, em modo **Pagamento Único** ou **Pagamento Combinado (2+ formas)**.

6. **Fechamento do Dia & Relatórios Operacionais:**
   - **Relatório de Caixa:** total líquido recebido nas 5 formas de pagamento (já descontando troco em Dinheiro), distinguindo **Produtos Glow Hub** vs. **Assinaturas BentoClub** (com rateio proporcional em pedidos mistos).
   - **Relatório de Discrepância de Caixa & Ajustes de Estoque:** conferência interativa por forma de pagamento (`CORRETO`, `FALTA`, `SOBRA`, `PENDENTE`) salva por data em `cashClosings`, combinada com a auditoria dos ajustes automáticos de estoque negativo.
   - **Relatório de Vendas:** listagem item a item com Produto/Clube, Quantidade, Valores Unitário e Subtotal, Ajuste de Estoque, Cliente (Nome + Celular) e **Emissor da Venda**.
   - **Relatório de Clientes Cadastrados no Dia:** diferenciação entre **Novo Cadastro** e **Celular Atualizado** no período selecionado.
   - **Consolidado por Cliente:** histórico detalhado agrupado por cliente, com filtros avançados, impressão e exportação **CSV/Excel (`UTF-8 BOM`)** + backup **JSON**.

---

## Como Publicar no GitHub Pages (`bentoco-sw/glowhub`)

Repositório de destino: `https://github.com/bentoco-sw/glowhub.git` (usuário `bentoco-sw`).  
URL final prevista do PWA: `https://bentoco-sw.github.io/glowhub/`.

> **Atenção sobre Privacidade e Visibilidade:** o pacote de produção inclui [`data/seed-data.js`](data/seed-data.js) e [`data/seed-data.json`](data/seed-data.json) com catálogo, operadores e clientes iniciais pré-carregados. Avalie utilizar repositório privado e/ou controle de acesso do GitHub Pages (quando disponível no plano), evitando expor publicamente dados de clientes sem necessidade. As planilhas originais em `Base de Apoio/` e o banco local `data/local-server-db.json` já estão bloqueados no [`.gitignore`](.gitignore).

O script [`scripts/prepare_deploy.py`](scripts/prepare_deploy.py) valida todos os assets do Service Worker ([`sw.js`](sw.js)) e gera o pacote limpo em `dist/gh-pages/` e `dist/glowhub-bentoclub-deploy.zip`.

### Opção A — Publicação Direta com Script Seguro (Recomendado — fora do Google Drive)
Como esta pasta reside no Google Drive, não inicializamos `.git/` diretamente dentro dela (evitando corrupção de sincronização). O script [`scripts/deploy_github.sh`](scripts/deploy_github.sh) cria o staging em `/tmp/glowhub-github-publish`, executa os testes, gera o commit limpo na branch `main` e envia ao GitHub:

1. Faça um dry-run local (sem enviar):
   ```bash
   ./scripts/deploy_github.sh
   ```
2. Para enviar para o repositório:
   - Via SSH como colaborador (`jleite-afluentes` com acesso de escrita):
     ```bash
     ./scripts/deploy_github.sh --ssh --push
     ```
   - Ou via HTTPS (usuário e token de `bentoco-sw`):
     ```bash
     ./scripts/deploy_github.sh --push
     ```
3. No GitHub (`https://github.com/bentoco-sw/glowhub/settings/pages`), confirme **Build and deployment → Source: GitHub Actions**. A action [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) rodará os testes e publicará automaticamente em `/glowhub/`.

### Opção B — Deploy Manual via Pacote Compactado (`dist/glowhub-bentoclub-deploy.zip`)
1. Gere/atualize o pacote rodando:
   ```bash
   PYTHONDONTWRITEBYTECODE=1 python3 scripts/prepare_deploy.py
   ```
2. Extraia `dist/glowhub-bentoclub-deploy.zip` e faça upload na branch `main` de `bentoco-sw/glowhub` (mantendo `.github/workflows/deploy-pages.yml` e `.nojekyll`).
3. Em **Settings → Pages**, selecione **Source: GitHub Actions** (ou **Deploy from a branch** → `main` / `/ (root)`).
4. Após a publicação, o PWA poderá ser instalado diretamente na tela inicial de **iPads, Tablets Android, iPhones e Smartphones Android** acessando `https://bentoco-sw.github.io/glowhub/`.

## Como Ativar a Sincronização em Tempo Real com Google Sheets (Opcional)

1. Crie uma nova planilha no **Google Sheets** e acesse **Extensões → Apps Script**.
2. Copie o conteúdo de [`backend/Code.gs`](backend/Code.gs) para o editor do Apps Script e salve.
3. Clique em **Implantar → Nova implantação → App da Web**, escolha **Executar como: Eu** e **Quem pode acessar: Qualquer pessoa**, e copie a URL gerada (`https://script.google.com/macros/s/.../exec`).
4. No PWA, clique no botão **Dados / Nuvem** no topo da tela, cole a URL do Apps Script e clique em **Salvar URL e Sincronizar Agora**. As 5 abas serão criadas automaticamente na planilha: `Vendas_PDV`, `Itens_Vendidos`, `Clientes_PDV`, `Estoque_GlowHub` e `Ajustes_Estoque`.
