# Arquitetura do Sistema — PDV PWA Glow Hub & BentoClub

**Identificadores de Especialistas e Contratos:** `ENG-01`, `ENG-08`, `ARC-02`, `ARC-10`, `DATA-03`, `CTR-PWA-AUTH-WALL-01`

---

## 1. Visão Arquitetural (`ARC-02` & `ENG-01`)

A aplicação é projetada para hospedagem estática no **GitHub Pages** sem dependência de servidor Node.js em tempo de execução, combinando:
1. **Frontend PWA Desacoplado (`index.html`, `styles.css`, `js/auth-guard.js`, `js/domain.js`, `js/storage.js`, `js/app.js`, `sw.js`, `manifest.webmanifest`):**
   - Implementa a Máquina de Estados Finita (FSM) do contrato `CTR-PWA-AUTH-WALL-01` (`BOOTSTRAP -> CHECKING_SESSION -> UNAUTHENTICATED -> AUTHENTICATED`).
   - O `index.html` contém exclusivamente o container `#app-root` com `#initial-loader`. Nenhuma tela de negócio existe no HTML inicial nem usa ocultamento por CSS (`display: none`).
   - Design System construído sobre a paleta oficial Bento (`#1D6452` Verde Escuro, `#81B6A2` Verde Claro, `#EADACE` Bege Claro, `#C49875` Caramelo, `#6A4228` Marrom Terra), tipografia limpa e alvos de toque mínimos de `48px` para uso ágil em Tablets e Smartphones.
2. **Camada de Dados e Persistência Híbrida (`ENG-08` & `DATA-03`):**
   - Pipeline determinístico `scripts/build_dataset.py` + `scripts/pdv_engine.py` que lê as planilhas brutas em `Base de Apoio/` e gera `data/seed-data.json` e `data/seed-data.js`.
   - Armazenamento local primário em **IndexedDB** (`bento_glow_pdv_db`) com espelhamento em `localStorage` para leitura síncrona rápida e resiliência offline, persistindo `sales`, `clients`, `products`, `stockAdjustments` (ajustes automáticos de estoque negativo) e `cashClosings` (conferência e discrepância diária de caixa).
   - Conector **Google Sheets Sync** (`backend/Code.gs` + fila de sincronização no cliente) com suporte a envio em lote (`SYNC_BATCH`) e verificação de token Google (`VERIFY_TOKEN`), gravando nas 5 abas oficiais (`Vendas_PDV`, `Itens_Vendidos` incluindo `Ajuste Estoque (+Un)`, `Clientes_PDV`, `Estoque_GlowHub` e `Ajustes_Estoque`).
3. **Segurança e Controle de Acesso (`ARC-10` & `CTR-PWA-AUTH-WALL-01`):**
   - Separação de papéis (`RBAC`): apenas usuários com `role === 'Gestor'` (`isAdmin === true`, isto é, `Carolina` e `João`) visualizam o Painel Executivo de Volume de Vendas por Segmento/Marca/Clube e ações administrativas de reset/configuração; todos os usuários autenticados acessam o fluxo de Fechamento do Dia & Relatórios (Caixa, Discrepância, Vendas com Emissor e Clientes do Dia).
   - Service Worker (`sw.js`, cache `bento-glow-pdv-shell-v1.1.0`) aplica *Network Only* para `script.google.com` e `oauth2.googleapis.com`, e *Cache First* para os assets estáticos da aplicação (incluindo `assets/glowhub-logo.png` e `assets/GlowHub-Oficial.png`).

---

## 2. Estrutura de Diretórios

```text
.
├── index.html                    # Casca vazia (CTR-PWA-AUTH-WALL-01)
├── styles.css                    # Estilos responsivos Tablet/Smartphone (Paleta Bento)
├── manifest.webmanifest          # Configuração PWA instalável
├── sw.js                         # Service Worker (Cache First estático / Network Only APIs)
├── assets/                       # Logos oficiais (GlowHub-Oficial.png / glowhub-logo.png, BentoClub, marcas)
├── data/
│   ├── seed-data.json            # Dataset canônico higienizado (12 usuários, 254 produtos, 31 clubes, 1721 clientes)
│   └── seed-data.js              # Bundle JS do dataset para carregamento zero-config
├── js/
│   ├── domain.js                 # Regras de negócio puras (catálogo, ajuste de estoque negativo, fechamento de caixa, relatórios)
│   ├── storage.js                # Persistência híbrida (IndexedDB + LocalStorage + CSV/Excel + stockAdjustments + cashClosings + Sync)
│   ├── auth-guard.js             # FSM de autenticação (BOOTSTRAP, CHECKING_SESSION, UNAUTHENTICATED, AUTHENTICATED)
│   └── app.js                    # Controlador de UI (PDV, Carrinho, Fechamento do Dia & Relatórios)
├── backend/
│   └── Code.gs                   # Backend Google Apps Script Zero-Trust + 5 abas Google Sheets (incl. Ajustes_Estoque)
├── scripts/
│   ├── pdv_engine.py             # Motor de domínio e higienização auditável em Python
│   └── build_dataset.py          # Extrator oficial das planilhas .xlsx para data/seed-data.{json,js}
└── tests/
    ├── test_pdv_engine.py        # Suíte de testes unitários e de integração (Python + WebKit JSC)
    └── pdv_app.test.js           # Suíte de testes JS com asserções físicas rastreadas na RTM
```
