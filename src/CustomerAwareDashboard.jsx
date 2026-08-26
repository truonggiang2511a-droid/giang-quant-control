import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getAccountLoginFromCard(card) {
  const detailBoxes = Array.from(
    card.querySelectorAll(".bot-details > *")
  );

  for (const box of detailBoxes) {
    const text = normalize(box.textContent);
    if (!text.includes("mt5 login")) continue;

    const raw = String(box.textContent || "");
    const match = raw.match(/MT5\s+LOGIN\s*([0-9]+)/i);
    if (match?.[1]) return match[1];

    const numbers = raw.match(/[0-9]{5,}/g);
    if (numbers?.[0]) return numbers[0];
  }

  return null;
}

function setNativeInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )?.set;

  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export default function CustomerAwareDashboard({ refreshToken = 0 }) {
  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [customerSearch, setCustomerSearch] = useState("");

  const accountMap = useMemo(() => {
    const map = new Map();

    for (const account of accounts) {
      const login = String(
        account?.mt5_login || account?.login || ""
      ).trim();

      if (!login) continue;

      const customer = customers.find(
        (item) => item.id === account.customer_id
      );

      map.set(login, {
        login,
        broker: account.broker || "",
        server: account.server || "",
        customerId: customer?.id || null,
        customerName: customer?.full_name || "",
        customerPhone: customer?.phone || "",
        customerEmail: customer?.email || "",
      });
    }

    return map;
  }, [accounts, customers]);

  async function loadCustomerContext() {
    if (!supabase) return;

    try {
      const [customerResult, accountResult] = await Promise.all([
        supabase
          .from("customers")
          .select("id, full_name, phone, email, status")
          .order("full_name", { ascending: true }),
        supabase
          .from("mt5_accounts")
          .select("id, customer_id, mt5_login, login, broker, server, status")
          .order("mt5_login", { ascending: true }),
      ]);

      if (customerResult.error) throw customerResult.error;
      if (accountResult.error) throw accountResult.error;

      setCustomers(customerResult.data || []);
      setAccounts(accountResult.data || []);
    } catch (error) {
      console.error("[GQX] CUSTOMER CONTEXT LOAD ERROR:", error);
    }
  }

  useEffect(() => {
    loadCustomerContext();
  }, [refreshToken]);

  useEffect(() => {
    if (!supabase) return undefined;

    const channel = supabase
      .channel("gqx-customer-aware-dashboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customers" },
        loadCustomerContext
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mt5_accounts" },
        loadCustomerContext
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let raf = 0;

    function applyCustomerContext() {
      if (disposed) return;

      const botCards = Array.from(
        document.querySelectorAll(".bot-card")
      );

      for (const card of botCards) {
        const login = getAccountLoginFromCard(card);
        const context = login ? accountMap.get(login) : null;
        const header = card.querySelector(".bot-card-header h3");
        const subtitle = card.querySelector(".bot-card-header .bot-subtitle");

        if (!header || !context?.customerName) continue;

        const originalEaName =
          card.dataset.gqxEaName || header.textContent?.trim() || "GIANG QUANT X";

        const originalSubtitle =
          card.dataset.gqxSubtitle || subtitle?.textContent?.trim() || "";

        card.dataset.gqxCustomerId = context.customerId || "";
        card.dataset.gqxCustomerName = context.customerName;
        card.dataset.gqxMt5Login = login || "";
        card.dataset.gqxEaName = originalEaName;
        card.dataset.gqxSubtitle = originalSubtitle;

        header.textContent = context.customerName;
        header.setAttribute(
          "title",
          `${context.customerName} · ${originalEaName}`
        );

        if (subtitle) {
          subtitle.textContent = [
            originalEaName,
            originalSubtitle,
          ]
            .filter(Boolean)
            .join(" · ");
        }
      }

      const miniCards = Array.from(
        document.querySelectorAll(".mini-bot-card")
      );

      for (const card of miniCards) {
        const loginText = String(card.textContent || "").match(/[0-9]{5,}/)?.[0];
        const context = loginText ? accountMap.get(loginText) : null;
        const heading = card.querySelector("h3");

        if (!heading || !context?.customerName) continue;

        const original =
          card.dataset.gqxEaName || heading.textContent?.trim() || "GIANG QUANT X";

        card.dataset.gqxEaName = original;
        card.dataset.gqxCustomerName = context.customerName;
        card.dataset.gqxMt5Login = loginText || "";
        heading.textContent = context.customerName;
        heading.setAttribute("title", `${context.customerName} · ${original}`);
      }

      const searchInput = document.querySelector(
        ".search-input:not(.gqx-customer-search)"
      );

      if (searchInput && !searchInput.dataset.gqxEnhanced) {
        searchInput.dataset.gqxEnhanced = "true";
        searchInput.placeholder =
          "Tìm khách hàng, MT5, EA, broker, server...";

        const customerInput = document.createElement("input");
        customerInput.type = "search";
        customerInput.className = "search-input gqx-customer-search";
        customerInput.placeholder =
          "Tìm khách hàng, MT5, EA, broker, server...";
        customerInput.value = customerSearch;
        customerInput.autocomplete = "off";

        Object.assign(customerInput.style, {
          width: "100%",
          margin: "0",
        });

        searchInput.style.display = "none";
        searchInput.parentElement?.insertBefore(
          customerInput,
          searchInput
        );

        customerInput.addEventListener("input", (event) => {
          const value = event.target.value || "";
          setCustomerSearch(value);
        });
      }

      const visibleInput = document.querySelector(
        ".gqx-customer-search"
      );

      if (visibleInput && visibleInput.value !== customerSearch) {
        visibleInput.value = customerSearch;
      }

      if (!visibleInput || !searchInput) return;

      const query = normalize(customerSearch);
      const matchingCustomer = query
        ? customers.find((customer) => {
            const haystack = [
              customer.full_name,
              customer.phone,
              customer.email,
            ]
              .filter(Boolean)
              .join(" ");
            return normalize(haystack).includes(query);
          })
        : null;

      if (matchingCustomer) {
        if ((searchInput.value || "") !== "") {
          setNativeInputValue(searchInput, "");
        }

        for (const card of botCards) {
          const customerId = card.dataset.gqxCustomerId || "";
          card.style.display =
            customerId === String(matchingCustomer.id) ? "" : "none";
        }
      } else {
        for (const card of botCards) {
          card.style.display = "";
        }

        if ((searchInput.value || "") !== customerSearch) {
          setNativeInputValue(searchInput, customerSearch);
        }
      }
    }

    function scheduleApply() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(applyCustomerContext);
    }

    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    scheduleApply();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [accountMap, customers, customerSearch]);

  return null;
}
