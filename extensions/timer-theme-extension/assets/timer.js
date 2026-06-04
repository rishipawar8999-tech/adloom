document.addEventListener("DOMContentLoaded", async () => {
  const containers = document.querySelectorAll(".rockit-timer-wrapper");
  if (containers.length === 0) return;

  containers.forEach(async (container) => {
      const productId = container.dataset.productId;
      if (!productId) return;

      try {
        // Edge Case 1: Opacity Animation to reduce CLS impact
        container.style.opacity = "0";
        container.style.transition = "opacity 0.4s ease-in-out";

        const res = await fetch(`/apps/timer?productId=${productId}&t=${Date.now()}`);
        if (!res.ok) return;
        
        const data = await res.json();
        let timerData = data.timer?.timer || data.timer;
        const serverTime = data.serverTime ? new Date(data.serverTime).getTime() : Date.now();
        const isDesignMode = container.dataset.designMode === "true";

        if (!timerData && !isDesignMode) {
          container.style.display = "none";
          return;
        }

        if (!timerData && isDesignMode) {
           timerData = {
               endTime: new Date(Date.now() + 86400000).toISOString(),
               style: JSON.stringify({
                   title: "Flash Sale Ends Soon!",
                   subtitle: "Don't miss out",
                   backgroundColor: "#000000",
                   titleColor: "#ffffff",
                   timerColor: "#ffffff",
                   labels: { days: "D", hours: "H", minutes: "M", seconds: "S" }
               })
           };
        }

        const { endTime, style } = timerData;
        if (!endTime) return;
        const end = new Date(endTime).getTime();
        
        // Edge Case 3 Solution: Server-Time Sync
        const timeOffset = Date.now() - serverTime;

        const config = JSON.parse(style || "{}");
        const isProductPage = window.location.pathname.includes("/products/");

        if (!isProductPage) {
           container.style.display = "none";
           return;
        }

        const headerSelectors = ["#shopify-section-header", "header.site-header", ".header-wrapper", "header", ".section-header"];
        let targetEl = null;

        if (config.cssSelector) targetEl = document.querySelector(config.cssSelector);

        if (!targetEl) {
            for (const selector of headerSelectors) {
                const el = document.querySelector(selector);
                if (el) { targetEl = el; break; }
            }
        }

        if (targetEl) {
            targetEl.parentNode.insertBefore(container, targetEl);
            container.style.display = "block";
            container.style.width = "100%";
            
            // Edge Case 2 Solution: Dynamic Z-Index & Fixed Positioning
            const targetStyle = window.getComputedStyle(targetEl);
            const targetZIndex = parseInt(targetStyle.zIndex) || 100;
            container.style.zIndex = (targetZIndex + 1).toString();
            
            if (targetStyle.position === "fixed") {
               container.style.position = "fixed";
               container.style.top = "0";
               // Offset the header down
               const containerHeight = container.offsetHeight || 40;
               targetEl.style.top = `${containerHeight}px`;
            }
            
            // Trigger Fade-In
            setTimeout(() => { container.style.opacity = "1"; }, 50);
        } else {
             container.style.display = "block";
             container.style.opacity = "1";
        }

        const bgStyle = (config.backgroundColor && config.backgroundColor.includes('gradient')) 
          ? `background: ${config.backgroundColor};` 
          : `background-color: ${config.backgroundColor || '#000'};`;

        const className = config.className || 'rockit-timer-bar';

        let html = `
          <div class="rockit-timer-box ${className}" style="
            ${bgStyle}
            border-top: ${config.borderSize || 0}px solid ${config.borderColor || 'transparent'};
            border-bottom: ${config.borderSize || 0}px solid ${config.borderColor || 'transparent'};
            padding: ${config.padding || 10}px;
            color: ${config.titleColor || '#fff'};
            font-size: ${config.fontSize || 15}px;
            font-family: ${config.typography || 'inherit'};
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 20px;
            width: 100%;
          ">
        `;

        html += `<div class="rockit-timer-text-group" style="display: flex; gap: 10px; align-items: center;">`;
        if (config.title) html += `<div style="font-weight: bold;">${config.title}</div>`;
        if (config.subtitle) html += `<div style="opacity: 0.9;">${config.subtitle}</div>`;
        html += `</div>`;

        if (timerData.hasTimer !== false) {
           html += `<div style="display: flex; gap: 15px; align-items: center;">`;
           const labels = config.labels || { days: "D", hours: "H", minutes: "M", seconds: "S" };
           ["days", "hours", "minutes", "seconds"].forEach(unit => {
             html += `
               <div style="text-align: center; line-height: 1;">
                 <div class="rockit-${unit}" style="font-weight: 800; font-family: monospace; font-size: 1.1em;">00</div>
                 <div style="font-size: 0.7em; text-transform: uppercase; opacity: 0.7;">${labels[unit]}</div>
               </div>
             `;
           });
           html += `</div>`;
        }
        html += `</div>`;
        
        container.innerHTML = html;

        const daysEl = container.querySelector(".rockit-days");
        const hoursEl = container.querySelector(".rockit-hours");
        const minutesEl = container.querySelector(".rockit-minutes");
        const secondsEl = container.querySelector(".rockit-seconds");

        const updateTimer = () => {
          // Use server-synced time
          const now = Date.now() - timeOffset;
          const distance = end - now;

          if (distance < 0) {
            container.style.display = "none";
            clearInterval(interval);
            return;
          }

          const days = Math.floor(distance / (1000 * 60 * 60 * 24));
          const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
          const seconds = Math.floor((distance % (1000 * 60)) / 1000);

          if (daysEl) daysEl.innerText = days < 10 ? `0${days}` : days;
          if (hoursEl) hoursEl.innerText = hours < 10 ? `0${hours}` : hours;
          if (minutesEl) minutesEl.innerText = minutes < 10 ? `0${minutes}` : minutes;
          if (secondsEl) secondsEl.innerText = seconds < 10 ? `0${seconds}` : seconds;
        };

        if (timerData.hasTimer !== false) {
           updateTimer();
           const interval = setInterval(updateTimer, 1000);
        }

      } catch (e) {
        console.error("Loom Timer Error:", e);
      }
  }); 
});
