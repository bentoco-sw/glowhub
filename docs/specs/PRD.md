# PRD — Sistema de Vendas PWA: Glow Hub & BentoClub (`PDV - Eventos`)

**Projeto:** PDV - Eventos (Glow Hub & BentoClub)  
**Slice:** `greenfield-pwa-pdv`  
**Objective ID:** `obj-001`  
**Status:** Especificação Aprovada via `/grill-me` (`antigravity:ask_question`)

---

## 1. Visão do Produto e Contexto Operacional

Sistema de Ponto de Venda (PDV) em arquitetura Progressive Web App (PWA), otimizado para operação touch em **Tablets e Smartphones** durante eventos e operação presencial (Black Bento / Glow Hub / BentoClub). Hospedado de forma estática no **GitHub Pages**, com persistência local resiliente (IndexedDB + LocalStorage fallback + exportação/importação CSV/Excel) e sincronização em nuvem pronta para múltiplos dispositivos via **Google Sheets (Google Apps Script)**.

---

## 2. Decisões Tomadas pelo Usuário (`/grill-me`)

- **`DEC-01` — Persistência Híbrida e GitHub Pages:** Operação 100% funcional no GitHub Pages com banco local (IndexedDB + exportação/importação CSV/Excel) e integração pronta com Google Sheets (`backend/Code.gs`) para sincronizar múltiplos Tablets/Smartphones em tempo real.
- **`DEC-02` — Login dos 12 Usuários e Visão Administrador:** Login por seleção/e-mail dos 12 usuários da planilha `Cadastro de Usuários.xlsx` (com suporte opcional a Google SSO) e visão de Administrador exclusiva para o cargo `Gestor` (`Carolina` e `João`).
- **`DEC-03` — Regras de Catálogo, Preços R$ 0,08 e Estoque com Ajuste Automático:** Incluir os 6 clubes (`Clube da Escova`, `Clube da Unha Clássica`, `Clube da Esmaltação em Gel` com `Manutenção de Alongamento`, `Clube da Massagem`, `Clube da Maquiagem` e `Clube da Cor`), ocultar os 3 itens Keune de `R$ 0,08` marcados com `*` (resultando em 254 produtos ativos), usar a logomarca oficial `GlowHub-Oficial.png` (`assets/glowhub-logo.png`) e **permitir** a venda mesmo quando o estoque estiver zerado ou insuficiente, registrando automaticamente o ajuste positivo necessário em `stockAdjustments` / aba `Ajustes_Estoque` e mantendo o saldo final em `0`.
- **`DEC-04` — Vínculo de Cliente no 1º Item do Carrinho e Checkout Multi-Pagamento:** Ao adicionar o 1º item ao carrinho, localizar ou cadastrar rapidamente o cliente (Nome + Celular), mantendo-o vinculado nos demais itens (inclusive carrinho misto Glow Hub + BentoClub). Se o cliente pré-cadastrado estiver com celular vazio ou `"0"`, exigir atualização do celular no vínculo. No Checkout, permitir pagamento único ou combinado entre PIX, Dinheiro, Cartão de Crédito (1x a 12x), Cartão de Débito e Transferência Bancária.

---

## 3. Requisitos Funcionais e Critérios de Aceite

| ID Requisito | Critério de Aceite | Descrição Funcional |
| --- | --- | --- |
| `REQ-01` | `AC-01` | **Auth Wall & Login de Usuários (`CTR-PWA-AUTH-WALL-01`):** O `index.html` deve iniciar como casca vazia (`#app-root` contendo apenas `#initial-loader`), sem elementos de negócio ocultos com `display: none`. Autenticação com os 12 usuários de `Cadastro de Usuários.xlsx` (higienizando espaços como `'Danielle '`), identificando `Gestor` (`Carolina` e `João`) como administradores. |
| `REQ-02` | `AC-02` | **Menu Principal e Escolha de Segmento:** Exibir seleção visual clara entre **Glow Hub** (logo oficial `GlowHub-Oficial.png` / `glowhub-logo.png`) e **BentoClub** (logo `BentoClubLogo.png`), além de navegação persistente para voltar ao Menu Principal e abrir/fechar o Carrinho em qualquer etapa. |
| `REQ-03` | `AC-03` | **Catálogo Glow Hub por Marcas:** Permitir filtragem pelas 3 marcas com logomarcas oficiais: **Davines** (`davines_logo.png`, 72 itens), **Keune** (`KeuneLogo.png`, 109 itens ativos) e **Kérastase** (`Kerastase-logo.jpg`, 73 itens), totalizando 254 produtos ativos após exclusão dos 3 itens `*` de `R$ 0,08`. |
| `REQ-04` | `AC-04` | **Catálogo BentoClub por Clubes:** Permitir seleção entre os 6 clubes (`Clube da Escova`, `Clube da Unha Clássica` com correção `Manicure`, `Clube da Esmaltação em Gel` incluindo `Manutenção de Alongamento`, `Clube da Massagem`, `Clube da Maquiagem` e `Clube da Cor`), exibindo as 31 opções com quantidade de sessões, tamanho/modalidade, validade e valor. |
| `REQ-05` | `AC-05` | **Lista em Cards e Busca Textual Instantânea:** Apresentar os itens em cards responsivos para Tablet/Smartphone com busca textual sem diferenciação de acentos/maiúsculas por nome, linha, família, categoria, benefício ou modalidade. |
| `REQ-06` | `AC-06` | **Venda com Estoque Zero/Insuficiente e Baixa Controlada:** Produtos com `estoque <= 0` ou quantidade solicitada maior que o saldo exibem badge informativo ("Gerará ajuste automático de +N un.") e têm venda liberada; ao concluir a venda, o saldo final do produto é travado em `0` e o déficit (`soldQty - max(0, available)`) gera registro auditável de ajuste. |
| `REQ-07` | `AC-07` | **Vínculo Obrigatório de Cliente no 1º Item + Cadastro Rápido:** Ao adicionar o primeiro item ao carrinho sem cliente vinculado, abrir modal de identificação/busca nos 1.721 clientes únicos (`Cadastro Clientes.xlsx`). Se o cliente tiver celular vazio/`"0"`, solicitar celular válido (10 ou 11 dígitos). Caso não exista, permitir cadastro rápido com Nome + Celular. |
| `REQ-08` | `AC-08` | **Gestão do Carrinho Misto:** Permitir adicionar produtos Glow Hub e assinaturas BentoClub no mesmo carrinho vinculado ao cliente, alterar quantidades respeitando estoque, remover itens, trocar cliente e fechar/abrir o drawer do carrinho. |
| `REQ-09` | `AC-09` | **Checkout com Pagamento Único ou Combinado:** Suportar `PIX`, `Dinheiro`, `Cartão de Crédito` (com seleção de parcelas), `Cartão de Débito` e `Transferência Bancária`. Validar em centavos inteiros que a soma dos pagamentos corresponde exatamente ao total do carrinho (ou calcular troco quando pago em Dinheiro). |
| `REQ-10` | `AC-10` | **Persistência Híbrida (Local + Google Sheets Sync):** Registrar cada venda e novo/atualizado cliente localmente (IndexedDB/LocalStorage), disponibilizar fila de sincronização automática/manual com endpoint Google Apps Script (`backend/Code.gs`) e permitir exportação/importação de backup JSON/CSV/Excel. |
| `REQ-11` | `AC-11` | **Painel de Administrador Exclusivo para Gestores:** Na tela principal, exibir exclusivamente para o cargo `Gestor` (`Carolina` e `João`) os KPIs executivos de volume financeiro (`R$`), quantidade de transações e itens vendidos segregados por segmento (**Glow Hub** vs **BentoClub**), por marca (`Davines`, `Keune`, `Kérastase`) e por clube de assinatura. |
| `REQ-12` | `AC-12` | **Relatório Detalhado de Vendas por Cliente:** Permitir consultar, filtrar (por cliente, segmento, marca/clube, vendedor, forma de pagamento e período) e exportar (CSV/Excel compatível com UTF-8 BOM e impressão/comprovante) tudo o que foi vendido por cliente. |
| `REQ-13` | `AC-13` | **Registro Automático de Ajuste de Estoque Negativo (`stockAdjustments`):** Toda venda que consuma estoque além do disponível registra automaticamente ID do ajuste, ID da venda, produto, marca, estoque anterior, quantidade vendida, unidades ajustadas (`+N un.`), valor equivalente, estoque resultante (`0`), cliente, emissor da venda e timestamp, sincronizando na aba `Ajustes_Estoque` do Google Sheets. |
| `REQ-14` | `AC-14` | **Fechamento do Dia & Relatórios Operacionais:** Na seção "Fechamento do Dia & Relatórios", emitir: (1) **Relatório de Caixa** com totais nas 5 formas de pagamento (deduzindo troco em Dinheiro e distinguindo **Produtos Glow Hub** vs **Clubes BentoClub** com rateio proporcional em carrinhos mistos); (2) **Relatório de Discrepância de Caixa & Ajustes de Estoque** com conferência interativa (`CORRETO` / `FALTA` / `SOBRA` / `PENDENTE`) salva em `cashClosings`; (3) **Relatório de Vendas** listando produto/clube, quantidade, valores unitário e total, cliente e **Emissor da Venda**; e (4) **Relatório de Clientes Cadastrados no Dia** (`Novo Cadastro` vs `Celular Atualizado`), com filtro por data, impressão e exportação CSV. |
