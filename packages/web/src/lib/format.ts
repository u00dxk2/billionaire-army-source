// The ladder moved to @ba/shared so the API and the web render a dollar identically —
// an inline copy in the daily-ten builder had already drifted and shipped a raw float to
// /today. Re-exported here so existing web call sites keep their import path.
export { formatCurrency } from "@ba/shared";
