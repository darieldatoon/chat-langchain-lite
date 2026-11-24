import { useEffect, useState } from "react";

import { QUEUE_NAME, type Api } from "./api";
import {
  COLUMNS,
  FILLS,
  reviewCells,
  ROWS,
  starterCells,
  starterFills,
  type Cells,
  type Fill,
  type Fills,
} from "./sheet";

type Status =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly count: number }
  | { readonly kind: "failed" };

export function statusText(status: Status): string {
  if (status.kind === "loading") return "Syncing…";
  if (status.kind === "failed")
    return "The queue could not load. You can still use the workbook locally.";
  return status.count
    ? `${status.count} queue rows loaded`
    : "Queue is empty — this is your ready-to-use review sheet.";
}

export function App({ api }: { readonly api: Api }) {
  const [cells, setCells] = useState<Cells>(() => starterCells(QUEUE_NAME));
  const [fills, setFills] = useState<Fills>(starterFills);
  const [selected, setSelected] = useState("A1");
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const formula = cells[selected] ?? "";

  useEffect(() => {
    api.reviewRows().then(
      (rows) => {
        // Merged over the current cells, so anything typed while loading stays.
        setCells((current) => ({ ...current, ...reviewCells(rows) }));
        setStatus({ kind: "loaded", count: rows.length });
      },
      () => setStatus({ kind: "failed" }),
    );
  }, [api]);

  const setCell = (address: string, value: string) =>
    setCells((current) => ({ ...current, [address]: value }));
  const paint = (fill: Fill) => setFills((current) => ({ ...current, [selected]: fill }));

  return (
    <main className="excel-app">
      <header className="excel-titlebar">
        <div className="excel-brand">
          <span className="excel-icon">▦</span>
          <strong>Review Sheet</strong>
          <span className="workbook-name">Annotation Review Workbook</span>
          <span className="saved-dot">● Saved</span>
        </div>
        <div className="window-controls" aria-hidden>
          <span>—</span>
          <span>□</span>
          <span>×</span>
        </div>
      </header>
      <nav className="excel-tabs" aria-label="Workbook tabs">
        <button className="tab-active">Home</button>
        <button>Insert</button>
        <button>Draw</button>
        <button>Page Layout</button>
        <button>Formulas</button>
        <button>Data</button>
        <button>Review</button>
        <button>View</button>
        <span className="tab-spacer" />
        <label>
          Queue <span>{QUEUE_NAME}</span>
        </label>
      </nav>
      <section className="excel-ribbon" aria-label="Home ribbon">
        <div className="ribbon-group">
          <span className="ribbon-label">Clipboard</span>
          <button className="paste-button">
            ▣<small>Paste</small>
          </button>
        </div>
        <div className="ribbon-group font-group">
          <span className="ribbon-label">Font</span>
          <select defaultValue="Aptos">
            <option>Aptos</option>
            <option>Arial</option>
            <option>Calibri</option>
          </select>
          <select defaultValue="11">
            <option>11</option>
            <option>10</option>
            <option>12</option>
          </select>
          <button>
            <b>B</b>
          </button>
          <button>
            <i>I</i>
          </button>
          <button>
            <u>U</u>
          </button>
        </div>
        <div className="ribbon-group fill-group">
          <span className="ribbon-label">Fill Color</span>
          {FILLS.map((color) => (
            <button
              key={color.label}
              className={`paint ${color.value || "none"} ${fills[selected] === color.value ? "paint-active" : ""}`}
              onClick={() => paint(color.value)}
              aria-label={`Fill selected cell ${color.label}`}
            >
              <span />
            </button>
          ))}
        </div>
        <div className="ribbon-group">
          <span className="ribbon-label">Alignment</span>
          <button>≡</button>
          <button>≣</button>
          <button>☷</button>
        </div>
        <div className="ribbon-group">
          <span className="ribbon-label">Number</span>
          <button>General⌄</button>
          <button>%</button>
          <button>,</button>
        </div>
        <div className="ribbon-status">{statusText(status)}</div>
      </section>
      <section className="formula-row" aria-label="Formula bar">
        <div className="name-field">{selected}</div>
        <span className="fx">fx</span>
        <input
          value={formula}
          onChange={(event) => setCell(selected, event.target.value)}
          aria-label="Formula bar"
        />
      </section>
      <section className="workbook" aria-label="Annotation spreadsheet">
        <div className="grid-wrap">
          <table className="excel-grid">
            <thead>
              <tr>
                <th className="corner" />
                {COLUMNS.map((column) => (
                  <th key={column} className="column-header">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row}>
                  <th className="row-header">{row}</th>
                  {COLUMNS.map((column) => {
                    const address = `${column}${row}`;
                    const value = cells[address] ?? "";
                    const fill = fills[address] ?? "";
                    return (
                      <td
                        key={address}
                        className={`grid-cell fill-${fill} ${selected === address ? "selected" : ""}`}
                        onClick={() => setSelected(address)}
                      >
                        <input
                          aria-label={address}
                          value={value}
                          onFocus={() => setSelected(address)}
                          onChange={(event) => setCell(address, event.target.value)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <footer className="sheet-footer">
        <span>Ready</span>
        <span>Accessibility: Good to go</span>
        <span className="footer-spacer" />
        <button>Normal</button>
        <button>Page Layout</button>
        <span>−</span>
        <span className="zoom">100%</span>
        <span>＋</span>
      </footer>
    </main>
  );
}
