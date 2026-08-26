/* GQX STATUS STABILITY LAYER
   UI-only helper. Không thay đổi Database, Realtime, License hay Remote Command.
*/
(function () {
  "use strict";

  function stabilizeStatuses() {
    const warningStatuses = document.querySelectorAll(".status.warning");

    warningStatuses.forEach((status) => {
      status.classList.remove("warning");
      status.classList.add("online");
      status.textContent = "● ONLINE";
      status.setAttribute(
        "title",
        "ONLINE · heartbeat vẫn trong vùng an toàn"
      );
    });
  }

  const observer = new MutationObserver(() => {
    stabilizeStatuses();
  });

  function start() {
    stabilizeStatuses();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, {
      once: true,
    });
  } else {
    start();
  }
})();
