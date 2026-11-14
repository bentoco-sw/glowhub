# Matriz de Rastreabilidade de Requisitos (RTM)

**Projeto:** PDV - Eventos (Glow Hub & BentoClub)  
**Slice:** `greenfield-pwa-pdv`  
**Objective ID:** `obj-001`

---

## Cobertura de Requisitos, Decisões, Contratos e Especialistas

| ID | Categoria | Descrição Resumida | Implementação Principal | Testes Verificados |
| --- | --- | --- | --- | --- |
| `REQ-01` | Requisito | Auth Wall e Login dos 12 usuários (`Carolina` e `João` Gestores) | `js/auth-guard.js`, `scripts/pdv_engine.py` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `REQ-02` | Requisito | Seleção de segmento Glow Hub (`GlowHub-Oficial.png`) ou BentoClub e navegação global | `js/app.js`, `js/domain.js`, `assets/glowhub-logo.png` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `REQ-03` | Requisito | Seleção de marcas Glow Hub (Davines, Keune, Kérastase) e filtro de R$ 0,08 | `scripts/pdv_engine.py`, `js/domain.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `REQ-04` | Requisito | Seleção dos 6 clubes BentoClub (31 opções com sessões e validades) | `scripts/pdv_engine.py`, `js/domain.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `REQ-05` | Requisito | Lista em cards e busca textual normalizada sem acentos | `scripts/pdv_engine.py`, `js/domain.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `REQ-06` | Requisito | Venda permitida com estoque zero/negativo mediante ajuste automático e trava final em 0 | `scripts/pdv_engine.py`, `js/domain.js`, `js/app.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `REQ-07` | Requisito | Vínculo de cliente no 1º item do carrinho, atualização de celular e cadastro rápido | `scripts/pdv_engine.py`, `js/domain.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `REQ-08` | Requisito | Carrinho misto (Glow Hub + BentoClub), quantidades e fechamento do carrinho | `scripts/pdv_engine.py`, `js/domain.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `REQ-09` | Requisito | Checkout com PIX, Dinheiro, Crédito, Débito e Transferência (único ou combinado) | `scripts/pdv_engine.py`, `js/domain.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `REQ-10` | Requisito | Persistência híbrida (IndexedDB + CSV/Excel + Google Sheets Apps Script) | `js/storage.js`, `backend/Code.gs` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `REQ-11` | Requisito | Painel de Administrador exclusivo para Gestores com volume por segmento e marca/clube | `scripts/pdv_engine.py`, `js/domain.js`, `js/app.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `REQ-12` | Requisito | Relatório detalhado de vendas por cliente com filtros e exportação CSV | `scripts/pdv_engine.py`, `js/domain.js`, `js/app.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `REQ-13` | Requisito | Registro automático de ajuste de estoque positivo para cobrir vendas com estoque insuficiente (`Ajustes_Estoque`) | `scripts/pdv_engine.py`, `js/domain.js`, `js/storage.js`, `backend/Code.gs`, `js/app.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `REQ-14` | Requisito | Fechamento do Dia: Caixa por pagamento × Produtos/Clubes, Discrepância de Caixa, Vendas c/ Emissor e Clientes do Dia | `scripts/pdv_engine.py`, `js/domain.js`, `js/storage.js`, `js/app.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `DEC-01` | Decisão | Persistência híbrida GitHub Pages + Google Sheets Sync | `js/storage.js`, `backend/Code.gs` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `DEC-02` | Decisão | Login dos 12 usuários e visão Admin restrita a Gestor (Carolina e João) | `js/auth-guard.js`, `scripts/pdv_engine.py` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `DEC-03` | Decisão | 6 clubes ativos, ocultação dos 3 itens R$ 0,08, venda com ajuste automático em estoque <= 0 e logo oficial GlowHUB | `scripts/pdv_engine.py`, `js/domain.js`, `assets/glowhub-logo.png` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `DEC-04` | Decisão | Cliente vinculado no 1º item, exigência de celular e pagamento combinado | `scripts/pdv_engine.py`, `js/domain.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `AC-01` | Critério | Verificação de casca vazia e login de usuários | `index.html`, `js/auth-guard.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `AC-02` | Critério | Navegação entre segmentos Glow Hub e BentoClub | `js/app.js`, `js/domain.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `AC-03` | Critério | Contagem e filtro exato das 3 marcas Glow Hub (254 produtos) | `scripts/pdv_engine.py`, `js/domain.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `AC-04` | Critério | Contagem e filtro exato dos 6 clubes BentoClub (31 opções) | `scripts/pdv_engine.py`, `js/domain.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `AC-05` | Critério | Busca textual insensível a acentos e caixa | `scripts/pdv_engine.py`, `js/domain.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `AC-06` | Critério | Liberação de venda em estoque insuficiente com cálculo de ajuste e trava de saldo final em 0 | `scripts/pdv_engine.py`, `js/domain.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `AC-07` | Critério | Validação de cliente e celular obrigatório no carrinho | `scripts/pdv_engine.py`, `js/domain.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `AC-08` | Critério | Operação de carrinho misto e cálculo em centavos | `scripts/pdv_engine.py`, `js/domain.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `AC-09` | Critério | Validação das 5 formas de pagamento e split payment | `scripts/pdv_engine.py`, `js/domain.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `AC-10` | Critério | Exportação/importação e payload de sincronização Apps Script | `js/storage.js`, `backend/Code.gs` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `AC-11` | Critério | Cálculo de volume por segmento, marca e clube para Gestor | `scripts/pdv_engine.py`, `js/domain.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `AC-12` | Critério | Geração de relatório de vendas por cliente e exportação CSV | `scripts/pdv_engine.py`, `js/domain.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `AC-13` | Critério | Registro auditável e idempotente de `stockAdjustments` no local storage e aba `Ajustes_Estoque` | `scripts/pdv_engine.py`, `js/domain.js`, `js/storage.js`, `backend/Code.gs` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `AC-14` | Critério | Relatórios de fechamento (Caixa × Segmento, Discrepância de Caixa, Vendas c/ Emissor, Clientes do Dia) com CSV e impressão | `scripts/pdv_engine.py`, `js/domain.js`, `js/app.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `CTR-PWA-AUTH-WALL-01` | Contrato | Casca vazia `#app-root`, FSM de autenticação, SW cache isolation e Backend Zero-Trust | `index.html`, `js/auth-guard.js`, `sw.js`, `backend/Code.gs` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `ENG-01` | Especialista | Arquitetura Frontend PWA responsiva para Tablet e Smartphone | `index.html`, `styles.css`, `js/app.js` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `ENG-08` | Especialista | Persistência local IndexedDB/LocalStorage e integridade transacional | `js/storage.js`, `scripts/pdv_engine.py` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `ARC-02` | Especialista | Arquitetura de plataforma desacoplada para GitHub Pages | `js/domain.js`, `js/storage.js`, `manifest.webmanifest` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `ARC-10` | Especialista | Segurança, RBAC Gestor vs Operador e Backend Zero-Trust | `js/auth-guard.js`, `backend/Code.gs` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
| `DATA-03` | Especialista | Higienização das planilhas e agregação analítica de vendas | `scripts/pdv_engine.py`, `scripts/build_dataset.py` | `tests/test_pdv_engine.py`, `tests/pdv_app.test.js` |
