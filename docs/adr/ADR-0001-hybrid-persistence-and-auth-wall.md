# ADR-0001: Persistência Híbrida (IndexedDB + Google Sheets Apps Script) e Auth Wall FSM no GitHub Pages

- **Status:** Aceito
- **Data:** 2026-11-14
- **Refs:** `DEC-01`, `DEC-02`, `CTR-PWA-AUTH-WALL-01`, `ENG-01`, `ENG-08`, `ARC-02`, `ARC-10`

## Contexto

O sistema PDV para venda de produtos **Glow Hub** e assinaturas **BentoClub** será hospedado no **GitHub Pages** (hospedagem estática) e operado em múltiplos **Tablets e Smartphones** durante eventos. O sistema precisa iniciar com os cadastros pré-carregados das 4 planilhas oficiais (`Cadastro de Usuários.xlsx`, `GlowHUB_Cadastro_Produtos.xlsx`, `Cadastro de Clubes.xlsx` e `Cadastro Clientes.xlsx`), funcionar mesmo sob oscilação de Wi-Fi/4G no evento e permitir consolidar vendas e clientes entre dispositivos.

## Decisão

1. **Extração Determinística de Dados (`scripts/build_dataset.py` + `scripts/pdv_engine.py`):** As planilhas originais em `Base de Apoio/` são processadas e higienizadas (remoção de `\xa0`, trim de nomes como `'Danielle '`, exclusão dos 3 itens Keune de `R$ 0,08`, deduplicação de 1.721 clientes, estruturação dos 6 clubes com validades oficiais e valores em centavos inteiros) gerando `data/seed-data.json` e `data/seed-data.js`.
2. **Persistência Local + Sincronização Nuvem (`js/storage.js` + `backend/Code.gs`):**
   - Todas as vendas, baixas de estoque e novos clientes ou atualizações de celular são gravados imediatamente no dispositivo via **IndexedDB** (`bento_glow_pdv_db`) e espelhados em `localStorage`.
   - O operador ou gestor pode exportar/importar arquivos **CSV/Excel** e **JSON** a qualquer instante, além de conectar a URL do Web App **Google Apps Script (`backend/Code.gs`)** para sincronização em tempo real entre múltiplos Tablets e Smartphones.
3. **Auth Wall (`CTR-PWA-AUTH-WALL-01`):**
   - O arquivo `index.html` contém apenas `<div id="app-root"><div class="loader-neutral" id="initial-loader">...</div></div>`.
   - A máquina de estados em `js/auth-guard.js` controla `BOOTSTRAP -> CHECKING_SESSION -> UNAUTHENTICATED -> AUTHENTICATED` e só injeta o DOM do PDV após autenticação válida.
   - O acesso ao Painel Executivo de Volume de Vendas é restrito ao cargo `Gestor` (`Carolina` e `João`).
