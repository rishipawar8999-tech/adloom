document.addEventListener("DOMContentLoaded", () => {
  initLoomCoupons();
  
  // MutationObserver for Section Rendering API
  const observer = new MutationObserver((mutations) => {
    const hasNewCoupons = Array.from(mutations).some(m => 
      Array.from(m.addedNodes).some(n => n.nodeType === 1 && (n.classList?.contains('rockit-coupons-wrapper') || n.querySelector?.('.rockit-coupons-wrapper')))
    );
    if (hasNewCoupons) initLoomCoupons();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Variant change listener
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      if (url.includes('variant=')) initLoomCoupons();
    }
  }).observe(document, {subtree: true, childList: true});
});

async function initLoomCoupons() {
  const containers = document.querySelectorAll(".rockit-coupons-wrapper:not([data-initialized])");
  if (containers.length === 0) return;

  containers.forEach(async (container) => {
    container.setAttribute("data-initialized", "true");
    const productId = container.dataset.productId;
    const tags = container.dataset.tags || "";
    const vendor = container.dataset.vendor || "";
    const collections = container.dataset.collections || "";
    if (!productId) return;

    try {
      container.style.opacity = "0";
      container.style.transition = "opacity 0.4s ease";

      const variantId = new URLSearchParams(window.location.search).get("variant") || "";
      const res = await fetch(`/apps/timer?type=coupons&productId=${productId}&variantId=${variantId}&tags=${encodeURIComponent(tags)}&vendor=${encodeURIComponent(vendor)}&collections=${encodeURIComponent(collections)}&t=${Date.now()}`);
      if (!res.ok) return;
      
      const data = await res.json();
      let coupons = data.coupons;
      const isDesignMode = container.dataset.designMode === "true";

      if ((!coupons || coupons.length === 0) && !isDesignMode) {
        container.style.display = "none";
        return;
      }
      
      if ((!coupons || coupons.length === 0) && isDesignMode) {
         coupons = [
            { offerTitle: "10% OFF Entire Order", couponCode: "WELCOME10", description: "Use this code at checkout" },
            { offerTitle: "Free Shipping", couponCode: "FREESHIP", description: "On orders over $50" }
         ];
      }
      const maxVisible = 2;
      const visibleCoupons = coupons.slice(0, maxVisible);
      const hiddenCoupons = coupons.slice(maxVisible);

      let html = `
        <div class="rockit-offers-container">
          <div class="rockit-offers-header">
            <strong>Offers For You</strong> <span>(Can be applied at checkout)</span>
          </div>
          <div class="rockit-offers-list">
      `;
      
      visibleCoupons.forEach((c, i) => {
        html += renderCouponCard(c, i);
      });

      if (hiddenCoupons.length > 0) {
        html += `<button class="rockit-more-btn" id="rockit-more-btn-${productId}">
          +${hiddenCoupons.length} more offer${hiddenCoupons.length > 1 ? "s" : ""} →
        </button>`;
      }

      html += `</div></div>`;

      // Build sidebar if needed
      if (hiddenCoupons.length > 0) {
        html += buildSidebar(productId, hiddenCoupons);
      }

      container.innerHTML = html;
      container.style.display = "block";
      setTimeout(() => container.style.opacity = "1", 50);

      attachCardEvents(container);
      
      if (hiddenCoupons.length > 0) {
        const moreBtn = document.getElementById(`rockit-more-btn-${productId}`);
        if (moreBtn) {
          moreBtn.addEventListener("click", () => openSidebar(productId));
        }
      }
    } catch (e) {
      console.error("[Loom Coupons]", e);
    }
  });
}

function renderCouponCard(coupon, index) {
  const desc = coupon.description ? `<div class="rockit-coupon-desc">${escapeHtml(coupon.description)}</div>` : "";
  
  let styleObj = {};
  let presetClass = "rockit-coupon-standard";
  let customStyles = "";

  try {
    if (coupon.style && coupon.style.startsWith('{')) {
      styleObj = JSON.parse(coupon.style);
      if (styleObj.preset) {
        presetClass = `coupon-${styleObj.preset}`;
      }
      customStyles = `
        --rc-bg: ${styleObj.backgroundColor || "#fff"};
        --rc-border: ${styleObj.borderColor || "#e3e3e3"};
        --rc-text: ${styleObj.textColor || "#1a1a1a"};
        border-style: ${styleObj.borderStyle || "solid"};
        border-radius: ${styleObj.borderRadius || 12}px;
        font-family: ${styleObj.typography || "inherit"};
      `;
    } else if (coupon.style) {
      presetClass = `coupon-${coupon.style}`;
    }
  } catch (e) {
    console.error("Style parse error", e);
  }

  const codeColorVal = styleObj.codeColor || "var(--rc-text)";
  const codeStyle = `color: ${codeColorVal}; font-size: ${styleObj.fontSize || 13}px;`;
  
  const tagIconSvg = `<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>`;

  return `
    <div class="rockit-coupon-card ${presetClass}" data-index="${index}" style="${customStyles}">
      <div class="rockit-coupon-header" data-action="toggle-accordion">
        <div class="rockit-coupon-header-left">
          <div class="rockit-coupon-icon">
            ${tagIconSvg}
            <div class="rockit-percent-badge">%</div>
          </div>
          <div class="rockit-coupon-info">
            <div class="rockit-coupon-offer">${escapeHtml(coupon.offerTitle)}</div>
            ${desc}
          </div>
        </div>
        <div class="rockit-coupon-chevron">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
      </div>
      <div class="rockit-coupon-body">
        <div class="rockit-coupon-body-content">
          <span class="rockit-coupon-code" style="${codeStyle}">${escapeHtml(coupon.couponCode)}</span>
          <button class="rockit-btn-copy-text" data-action="copy" data-code="${escapeHtml(coupon.couponCode)}">Copy Code</button>
        </div>
      </div>
    </div>`;
}

function buildSidebar(productId, coupons) {
  let cardsHtml = "";
  coupons.forEach((c, i) => {
    cardsHtml += renderCouponCard(c, i);
  });

  return `
    <div class="rockit-sidebar-overlay" id="rockit-sidebar-overlay-${productId}"></div>
    <div class="rockit-sidebar" id="rockit-sidebar-${productId}">
      <div class="rockit-sidebar-body rockit-sidebar-no-header">
        ${cardsHtml}
        <button class="rockit-sidebar-close-btn" id="rockit-sidebar-close-${productId}">
          Close
        </button>
      </div>
    </div>`;
}

function openSidebar(productId) {
  const sidebar = document.getElementById(`rockit-sidebar-${productId}`);
  const overlay = document.getElementById(`rockit-sidebar-overlay-${productId}`);
  if (!sidebar || !overlay) return;

  sidebar.classList.add("open");
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";

  // Attach close handlers
  const closeBtn = document.getElementById(`rockit-sidebar-close-${productId}`);
  if (closeBtn) closeBtn.onclick = () => closeSidebar(productId);
  overlay.onclick = () => closeSidebar(productId);
  
  // Attach card events inside sidebar
  attachCardEvents(sidebar);
}

function closeSidebar(productId) {
  const sidebar = document.getElementById(`rockit-sidebar-${productId}`);
  const overlay = document.getElementById(`rockit-sidebar-overlay-${productId}`);
  if (sidebar) sidebar.classList.remove("open");
  if (overlay) overlay.classList.remove("open");
  document.body.style.overflow = "";
}

function attachCardEvents(root) {
  // Single accordion: only one open at a time within the same root
  root.querySelectorAll('[data-action="toggle-accordion"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".rockit-coupon-card");
      const list = card.closest(".rockit-offers-list, .rockit-sidebar-body");
      
      // Close all other cards in this list
      if (list) {
        list.querySelectorAll(".rockit-coupon-card.is-expanded").forEach((openCard) => {
          if (openCard !== card) openCard.classList.remove("is-expanded");
        });
      }
      
      card.classList.toggle("is-expanded");
    });
  });

  root.querySelectorAll('[data-action="copy"]').forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const code = btn.dataset.code;
      const originalText = btn.textContent;

      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = originalText;
          btn.classList.remove("copied");
        }, 2000);
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = code;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = originalText;
          btn.classList.remove("copied");
        }, 2000);
      }
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
