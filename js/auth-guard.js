/* global globalThis */
/**
 * Auth Wall & Finite State Machine (CTR-PWA-AUTH-WALL-01 / REQ-01 / DEC-02 / ARC-10)
 * States: BOOTSTRAP -> CHECKING_SESSION -> UNAUTHENTICATED -> AUTHENTICATED
 * Zero business DOM exists before AUTHENTICATED.
 */
(function (root) {
  "use strict";

  const SESSION_USER_KEY = "bento_glow_pdv_session_user_v1";
  const GOOGLE_TOKEN_KEY = "google_id_token";

  const AuthState = {
    BOOTSTRAP: "BOOTSTRAP",
    CHECKING_SESSION: "CHECKING_SESSION",
    UNAUTHENTICATED: "UNAUTHENTICATED",
    AUTHENTICATED: "AUTHENTICATED"
  };

  let currentState = AuthState.BOOTSTRAP;
  let currentUser = null;
  let loginFilterQuery = "";

  function getAppRoot() {
    if (typeof document === "undefined") return null;
    return document.getElementById("app-root");
  }

  function getSeedUsers() {
    const seed = root.PDV_SEED_DATA;
    return (seed && Array.isArray(seed.users)) ? seed.users : [];
  }

  function getSavedSessionUser() {
    if (typeof sessionStorage === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(SESSION_USER_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.email) return null;
      return root.PDVDomain.authenticateUser(getSeedUsers(), parsed.email);
    } catch (_err) {
      return null;
    }
  }

  function saveSessionUser(user) {
    if (typeof sessionStorage === "undefined") return;
    try {
      if (user) {
        sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
      } else {
        sessionStorage.removeItem(SESSION_USER_KEY);
        sessionStorage.removeItem(GOOGLE_TOKEN_KEY);
      }
    } catch (_err) {
      // ignore
    }
  }

  async function verifyTokenWithBackend(token, apiUrl) {
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "VERIFY_TOKEN", idToken: token })
    });
    return await resp.json();
  }

  function transitionTo(newState, payload) {
    currentState = newState;
    const container = getAppRoot();

    switch (currentState) {
      case AuthState.BOOTSTRAP: {
        const savedUser = getSavedSessionUser();
        const existingGoogleToken = typeof sessionStorage !== "undefined"
          ? sessionStorage.getItem(GOOGLE_TOKEN_KEY)
          : null;
        if (savedUser) {
          transitionTo(AuthState.CHECKING_SESSION, { user: savedUser, token: existingGoogleToken });
        } else {
          transitionTo(AuthState.UNAUTHENTICATED);
        }
        break;
      }

      case AuthState.CHECKING_SESSION: {
        if (container) {
          container.innerHTML =
            '<div class="loader-neutral" id="session-checking-loader">' +
            '<div class="spinner-ring"></div>' +
            "<p>Validando credenciais corporativas...</p>" +
            "</div>";
        }
        const candidateUser = payload && payload.user
          ? payload.user
          : root.PDVDomain.authenticateUser(getSeedUsers(), payload && payload.identifier);

        if (candidateUser) {
          saveSessionUser(candidateUser);
          transitionTo(AuthState.AUTHENTICATED, candidateUser);
        } else {
          saveSessionUser(null);
          transitionTo(AuthState.UNAUTHENTICATED, {
            error: "Usuário não localizado na lista oficial de operadores autorizados."
          });
        }
        break;
      }

      case AuthState.UNAUTHENTICATED: {
        currentUser = null;
        if (container) {
          renderAuthWall(container, payload);
        }
        break;
      }

      case AuthState.AUTHENTICATED: {
        currentUser = payload;
        if (container && root.PDVApp && typeof root.PDVApp.mountDashboard === "function") {
          root.PDVApp.mountDashboard(container, currentUser);
        }
        break;
      }
    }
    return currentState;
  }

  function escapeHtml(str) {
    return String(str === null || str === undefined ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderAuthWall(container, options) {
    const users = getSeedUsers();
    const errorMsg = (options && options.error) || "";
    const normFilter = root.PDVDomain ? root.PDVDomain.normalizeText(loginFilterQuery) : "";

    const filteredUsers = users.filter(function (u) {
      if (!normFilter) return true;
      const hay = root.PDVDomain.normalizeText(u.name + " " + u.shortName + " " + u.email + " " + u.role);
      return hay.indexOf(normFilter) !== -1;
    });

    const userCardsHtml = filteredUsers.map(function (u) {
      const isGestor = u.isAdmin || u.role === "Gestor";
      const roleBadgeClass = isGestor ? "role-badge role-badge-admin" : "role-badge";
      const roleLabel = isGestor ? "Gestor • Administrador" : u.role;
      const initials = u.shortName
        .split(" ")
        .map(function (p) { return p.charAt(0); })
        .join("")
        .slice(0, 2)
        .toUpperCase();

      return (
        '<button type="button" class="user-login-card" data-user-email="' + escapeHtml(u.email) + '">' +
          '<div class="user-avatar ' + (isGestor ? "avatar-admin" : "") + '">' + escapeHtml(initials) + "</div>" +
          '<div class="user-card-info">' +
            '<div class="user-card-top">' +
              '<strong class="user-short-name">' + escapeHtml(u.shortName) + "</strong>" +
              '<span class="' + roleBadgeClass + '">' + escapeHtml(roleLabel) + "</span>" +
            "</div>" +
            '<span class="user-full-name">' + escapeHtml(u.name) + "</span>" +
            '<span class="user-email">' + escapeHtml(u.email) + "</span>" +
          "</div>" +
          '<span class="user-login-arrow" aria-hidden="true">→</span>' +
        "</button>"
      );
    }).join("");

    container.innerHTML =
      '<section class="auth-wall-screen" aria-label="Autenticação do Ponto de Venda">' +
        '<div class="auth-wall-card">' +
          '<div class="auth-brand-row">' +
            '<img src="assets/bento-logo-verde.png" alt="Bento" class="auth-logo-bento" />' +
            '<div class="auth-brand-divider"></div>' +
            '<img src="assets/glowhub-logo.png" alt="Glow Hub" class="auth-logo-glow" />' +
            '<img src="assets/bentoclub-logo.png" alt="BentoClub" class="auth-logo-club" />' +
          "</div>" +
          '<div class="auth-header-text">' +
            "<h1>GlowHub &amp; BentoClub</h1>" +
            "<p>Selecione seu usuário ou informe seu e-mail cadastrado para iniciar as vendas no Tablet ou Smartphone.</p>" +
          "</div>" +
          (errorMsg ? '<div class="auth-alert-error" role="alert">' + escapeHtml(errorMsg) + "</div>" : "") +
          '<form id="auth-email-form" class="auth-search-bar" autocomplete="off">' +
            '<input type="search" id="auth-user-search" class="input-touch" ' +
              'placeholder="Buscar por nome, cargo ou digitar e-mail..." ' +
              'value="' + escapeHtml(loginFilterQuery) + '" aria-label="Buscar operador ou digitar e-mail" />' +
            '<button type="submit" class="btn-primary">Entrar</button>' +
          "</form>" +
          '<div class="auth-users-grid" id="auth-users-grid">' +
            (userCardsHtml || '<p class="empty-hint">Nenhum operador encontrado para o filtro informado.</p>') +
          "</div>" +
          '<div class="auth-sso-footer">' +
            '<div id="gis-button-slot" class="gis-slot"></div>' +
            '<small class="auth-security-note">Visão de Administrador habilitada para o cargo <strong>Gestor</strong> (Carolina e João).</small>' +
          "</div>" +
        "</div>" +
      "</section>";

    bindAuthWallEvents(container);
  }

  function bindAuthWallEvents(container) {
    const searchInput = container.querySelector("#auth-user-search");
    if (searchInput) {
      searchInput.addEventListener("input", function (e) {
        loginFilterQuery = e.target.value || "";
        renderAuthWall(container);
        const restored = container.querySelector("#auth-user-search");
        if (restored) {
          restored.focus();
          try {
            restored.setSelectionRange(loginFilterQuery.length, loginFilterQuery.length);
          } catch (_err) {
            // ignore on input[type=search]
          }
        }
      });
    }

    const form = container.querySelector("#auth-email-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        const val = (searchInput && searchInput.value) ? searchInput.value.trim() : "";
        const directMatch = root.PDVDomain.authenticateUser(getSeedUsers(), val);
        if (directMatch) {
          loginFilterQuery = "";
          transitionTo(AuthState.CHECKING_SESSION, { user: directMatch });
          return;
        }
        const firstCard = container.querySelector(".user-login-card[data-user-email]");
        if (firstCard) {
          const email = firstCard.getAttribute("data-user-email");
          const matched = root.PDVDomain.authenticateUser(getSeedUsers(), email);
          if (matched) {
            loginFilterQuery = "";
            transitionTo(AuthState.CHECKING_SESSION, { user: matched });
            return;
          }
        }
        renderAuthWall(container, { error: "Selecione um dos 12 operadores autorizados ou digite um e-mail válido." });
      });
    }

    const cards = container.querySelectorAll(".user-login-card[data-user-email]");
    for (let i = 0; i < cards.length; i++) {
      cards[i].addEventListener("click", function (e) {
        const email = e.currentTarget.getAttribute("data-user-email");
        const matched = root.PDVDomain.authenticateUser(getSeedUsers(), email);
        if (matched) {
          loginFilterQuery = "";
          transitionTo(AuthState.CHECKING_SESSION, { user: matched });
        }
      });
    }

    // Initialize Google Identity Services if configured
    const cfg = root.PDVStorage ? root.PDVStorage.loadSyncConfig() : {};
    if (cfg.googleClientId && typeof root.google !== "undefined" && root.google.accounts && root.google.accounts.id) {
      try {
        root.google.accounts.id.initialize({
          client_id: cfg.googleClientId,
          callback: function (res) {
            if (typeof sessionStorage !== "undefined") {
              sessionStorage.setItem(GOOGLE_TOKEN_KEY, res.credential);
            }
            if (cfg.appsScriptUrl) {
              verifyTokenWithBackend(res.credential, cfg.appsScriptUrl).then(function (result) {
                if (result && result.authorized && result.user) {
                  const matched = root.PDVDomain.authenticateUser(getSeedUsers(), result.user.email);
                  transitionTo(AuthState.CHECKING_SESSION, { user: matched });
                } else {
                  transitionTo(AuthState.UNAUTHENTICATED, { error: "Conta Google não autorizada." });
                }
              }).catch(function () {
                transitionTo(AuthState.UNAUTHENTICATED, { error: "Falha ao validar token Google no backend." });
              });
            }
          },
          auto_select: false
        });
        const slot = container.querySelector("#gis-button-slot");
        if (slot) {
          root.google.accounts.id.renderButton(slot, { theme: "outline", size: "large", text: "signin_with" });
        }
      } catch (_err) {
        // ignore GIS errors when offline
      }
    }
  }

  function loginWithIdentifier(identifier) {
    const matched = root.PDVDomain.authenticateUser(getSeedUsers(), identifier);
    if (!matched) {
      return transitionTo(AuthState.UNAUTHENTICATED, {
        error: "Operador não encontrado."
      });
    }
    return transitionTo(AuthState.CHECKING_SESSION, { user: matched });
  }

  function logout() {
    saveSessionUser(null);
    return transitionTo(AuthState.UNAUTHENTICATED);
  }

  function getState() {
    return currentState;
  }

  function getCurrentUser() {
    return currentUser;
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    window.addEventListener("DOMContentLoaded", function () {
      transitionTo(AuthState.BOOTSTRAP);
    });
  }

  root.PDVAuthGuard = {
    AuthState: AuthState,
    transitionTo: transitionTo,
    loginWithIdentifier: loginWithIdentifier,
    logout: logout,
    getState: getState,
    getCurrentUser: getCurrentUser,
    verifyTokenWithBackend: verifyTokenWithBackend
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
