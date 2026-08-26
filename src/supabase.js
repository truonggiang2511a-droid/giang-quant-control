import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function makeLicenseKey() {
  const year = new Date().getFullYear();
  const stamp = Date.now().toString(36).toUpperCase().slice(-6);
  const random = Math.random().toString(36).toUpperCase().slice(2, 5);
  return `GQX-${year}-${stamp}${random}`;
}

function wrapLicenseTable(client) {
  const originalFrom = client.from.bind(client);

  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "from") {
        return Reflect.get(target, property, receiver);
      }

      return (table) => {
        const builder = originalFrom(table);

        if (table !== "licenses") {
          return builder;
        }

        const originalInsert = builder.insert.bind(builder);

        builder.insert = async (values, options) => {
          const rows = Array.isArray(values) ? values : [values];
          const preparedRows = rows.map((row) => ({ ...row }));

          for (const row of preparedRows) {
            let candidate = row.license_key?.trim();

            if (!candidate) {
              candidate = makeLicenseKey();
            }

            // Nếu key đã tồn tại, tự sinh key mới.
            for (let attempt = 0; attempt < 5; attempt += 1) {
              const { data, error } = await originalFrom("licenses")
                .select("id")
                .eq("license_key", candidate)
                .limit(1);

              if (error) {
                console.warn("LICENSE KEY CHECK:", error.message);
                break;
              }

              if (!data || data.length === 0) {
                break;
              }

              candidate = makeLicenseKey();
            }

            row.license_key = candidate;
          }

          return originalInsert(
            Array.isArray(values) ? preparedRows : preparedRows[0],
            options
          );
        };

        return builder;
      };
    },
  });
}

const rawSupabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;

export const supabase = rawSupabase
  ? wrapLicenseTable(rawSupabase)
  : null;
