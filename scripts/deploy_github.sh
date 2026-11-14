#!/usr/bin/env bash
set -euo pipefail

# Safe GitHub publisher for GlowHub & BentoClub.
# Stages outside Google Drive so Drive sync never corrupts .git/objects.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GITHUB_USER="${GITHUB_USER:-bentoco-sw}"
GITHUB_EMAIL="${GITHUB_EMAIL:-bentoco-sw@users.noreply.github.com}"
GITHUB_REPO="${GITHUB_REPO:-https://github.com/bentoco-sw/glowhub.git}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"
STAGE_DIR="${STAGE_DIR:-/tmp/glowhub-github-publish}"
COMMIT_MSG="${COMMIT_MSG:-Deploy GlowHub & BentoClub PWA}"

DO_PUSH="false"
USE_SSH="${USE_SSH:-false}"
for arg in "$@"; do
  case "$arg" in
    --push)
      DO_PUSH="true"
      ;;
    --ssh)
      USE_SSH="true"
      ;;
    --help|-h)
      cat <<EOF
Uso: ./scripts/deploy_github.sh [--ssh] [--push]

Opções:
  (sem flags)   Valida testes + build, prepara staging Git fora do Google Drive (${STAGE_DIR})
                e exibe os arquivos prontos para commit/push (dry-run seguro).
  --ssh         Usa remoto SSH (git@github.com:bentoco-sw/glowhub.git) — ideal para jleite-afluentes.
  --push        Faz commit e envia (git push) para o remoto configurado (branch ${GITHUB_BRANCH}).

Variáveis opcionais:
  GITHUB_REPO   URL remota (padrão: https://github.com/bentoco-sw/glowhub.git)
  GITHUB_USER   Usuário autor do commit (padrão: bentoco-sw)
  GITHUB_EMAIL  E-mail do commit (padrão: bentoco-sw@users.noreply.github.com)
  COMMIT_MSG    Mensagem do commit
EOF
      exit 0
      ;;
    *)
      echo "Argumento desconhecido: $arg (use --help)" >&2
      exit 1
      ;;
  esac
done

if [ "$USE_SSH" = "true" ]; then
  GITHUB_REPO="git@github.com:bentoco-sw/glowhub.git"
fi

echo "[1/5] Executando suíte de testes e validação do bundle..."
(
  cd "$ROOT_DIR"
  PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
  PYTHONDONTWRITEBYTECODE=1 python3 scripts/prepare_deploy.py
)

echo "[2/5] Preparando repositório Git temporário em: $STAGE_DIR"
rm -rf "$STAGE_DIR"
if GIT_TERMINAL_PROMPT=0 git clone --depth 1 --branch "$GITHUB_BRANCH" "$GITHUB_REPO" "$STAGE_DIR" 2>/dev/null; then
  echo "      Branch remota '$GITHUB_BRANCH' clonada com sucesso."
else
  mkdir -p "$STAGE_DIR"
  git -C "$STAGE_DIR" init -b "$GITHUB_BRANCH" >/dev/null
  git -C "$STAGE_DIR" remote add origin "$GITHUB_REPO"
  echo "      Novo repositório inicializado para primeira publicação em '$GITHUB_BRANCH'."
fi

git -C "$STAGE_DIR" config user.name "$GITHUB_USER"
git -C "$STAGE_DIR" config user.email "$GITHUB_EMAIL"

echo "[3/5] Sincronizando arquivos limpos (protegendo planilhas de 'Base de Apoio/' e DB local)..."
rsync -a --delete \
  --exclude='.git/' \
  --exclude='.DS_Store' \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
  --exclude='*.pyo' \
  --exclude='dist/' \
  --exclude='data/local-server-db.json' \
  --exclude='Iniciar_Servidor_PDV.command' \
  --exclude='.agents/' \
  --exclude='.ai-squad/' \
  --exclude='Base de Apoio/' \
  --exclude='AI-SQUAD-SDD-ANTIGRAVITY.md' \
  --exclude='CANDIDATE-NOTICE.md' \
  --exclude='RELEASE-STATUS.md' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='*.log' \
  --exclude='*.tmp' \
  --exclude='*.bak' \
  "$ROOT_DIR/" "$STAGE_DIR/"

echo "[4/5] Verificando alterações para commit..."
git -C "$STAGE_DIR" add -A

if git -C "$STAGE_DIR" diff --cached --quiet; then
  echo "      Nenhuma alteração nova detectada em relação à branch '$GITHUB_BRANCH'."
else
  git -C "$STAGE_DIR" commit -m "$COMMIT_MSG" >/dev/null
  echo "      Commit criado em '$GITHUB_BRANCH' com $(git -C "$STAGE_DIR" ls-files | wc -l | tr -d ' ') arquivos."
fi

if [ "$DO_PUSH" = "true" ]; then
  echo "[5/5] Enviando para GitHub ($GITHUB_REPO -> $GITHUB_BRANCH)..."
  git -C "$STAGE_DIR" push -u origin "$GITHUB_BRANCH"
  echo ""
  echo "Deploy enviado com sucesso!"
  echo "Acompanhe em: https://github.com/bentoco-sw/glowhub/actions"
  echo "URL prevista do PWA: https://bentoco-sw.github.io/glowhub/"
else
  echo "[5/5] Dry-run concluído. Repositório pronto para push em: $STAGE_DIR"
  git -C "$STAGE_DIR" show --stat --oneline -1
  echo ""
  echo "Arquivos monitorados prontos: $(git -C "$STAGE_DIR" ls-files | wc -l | tr -d ' ')"
  echo "Para enviar ao GitHub agora via SSH (colaborador jleite-afluentes), execute:"
  echo "  ./scripts/deploy_github.sh --ssh --push"
  echo "Ou via HTTPS (usuário bentoco-sw):"
  echo "  ./scripts/deploy_github.sh --push"
fi
