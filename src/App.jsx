import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { buildValidationAnalytics, trackEvent, trackPageView } from "./analytics";

// ─── DESIGN SYSTEM ────────────────────────────────────────────────────────────
const B = {
  // Core brutalist palette
  cream:    "#F5F0E8",
  ink:      "#0A0A0A",
  white:    "#FAFAF7",
  grey1:    "#EFEFEC",
  grey2:    "#D8D5CF",
  grey3:    "#A8A49C",
  grey4:    "#6B6760",
  // Accents
  green:    "#00AA4E",
  greenDk:  "#007A38",
  greenLt:  "#D4EAC6",
  teal:     "#08BC9C",
  sage:     "#80CA75",
  // Status
  red:      "#CC2222",
  redLt:    "#FFF0F0",
  redDk:    "#8B0000",
  orange:   "#C96800",
  orangeLt: "#FFF8EC",
  yellowLt: "#FFFBE6",
  // turtle
  turtleGreen: "#2D7A1F",
};

const FH = "'Manrope','Arial Black',system-ui,sans-serif";
const FB = "'Inter','Arial',system-ui,sans-serif";
const FM = "'JetBrains Mono','Courier New',monospace";

const BORDER     = `2px solid ${B.ink}`;
const BORDER_SM  = `1.5px solid ${B.ink}`;
const SHADOW     = `4px 4px 0 ${B.ink}`;
const SHADOW_SM  = `2px 2px 0 ${B.ink}`;
const SHADOW_LG  = `6px 6px 0 ${B.ink}`;

// ─── TEXTURE SVG (noise overlay) ──────────────────────────────────────────────
const NOISE_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E")`;

const HALFTONE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Ccircle cx='8' cy='8' r='2.2' fill='%230A0A0A' opacity='0.06'/%3E%3C/svg%3E")`;

// ─── FIELDS ───────────────────────────────────────────────────────────────────
const FIELDS = [
  { key:"uan",        label:"UAN",           pos:0,  tt:"Universal Account Number — exactly 12 digits. EPFO uses this to credit the correct member account. Common error: Old 11-digit ID, or pasted with spaces/dashes." },
  { key:"memberName", label:"Member Name",   pos:1,  tt:"Employee's full name as registered in EPFO/Aadhaar. Must match the UAN-linked profile." },
  { key:"grossWages", label:"Gross Wages",   pos:2,  tt:"Total salary paid: Basic + DA + HRA + all allowances. EPF Wages must always be ≤ Gross Wages." },
  { key:"epfWages",   label:"EPF Wages",     pos:3,  tt:"PF-eligible salary: Basic + DA only. All contribution calculations depend on this field." },
  { key:"epsWages",   label:"EPS Wages",     pos:4,  tt:"Pensionable salary — capped at ₹15,000/month for Normal Pensioners. No cap for confirmed Higher Pensioners (SC 2022 order)." },
  { key:"edliWages",  label:"EDLI Wages",    pos:5,  tt:"Wage base for EDLI insurance. Must always equal EPF Wages — no separate calculation." },
  { key:"epfContrib", label:"EE EPF",        pos:6,  tt:"Employee's PF deduction = exactly 12% of EPF Wages. EPFO applies zero tolerance — even ₹1 error is flagged." },
  { key:"epsContrib", label:"EPS Contrib",   pos:7,  tt:"Employer EPS contribution. Normal: 8.33% of EPS Wages, max ₹1,250. Higher Pensioner: 8.33% + 1.16% on EPS above ₹15k." },
  { key:"epfEr",      label:"ER PF",         pos:8,  tt:"Employer PF = 3.67% of EPF Wages + EPS differential. Ensures total employer share = 12% of EPF Wages." },
  { key:"ncp",        label:"NCP Days",      pos:9,  tt:"Non-Contributing Period days (LWP, mid-month join/exit). Range: 0–31. Affects EPS pensionable service." },
  { key:"refunds",    label:"Refund Adv",    pos:10, tt:"Repayment of PF advance under para 68-B/68-BB/68-J. Set to 0 if no advance recovery this month." },
];
const N = 11;
const DELIM = "#~#";

// ─── HANDBOOK ─────────────────────────────────────────────────────────────────
const HB = {
  STRUCTURE:         {code:"ECR-001",title:"Row structure is broken",        why:"Each ECR row must have exactly 11 fields separated by #~#. One missing separator and EPFO's parser rejects the entire row.",impact:"Row completely rejected. No contributions credited for this employee.",causes:["Copy-paste introduced a line break mid-row","Delimiter typed as # not #~#","A field value accidentally contained #~#"],fix:["Count separators — need exactly 10 × #~# per row","Replace any stray # that aren't delimiters","Re-export from payroll if source data is corrupted"]},
  UAN:               {code:"ECR-002",title:"Invalid UAN",                    why:"A UAN is always exactly 12 digits. EPFO uses it to credit the correct member's account.",impact:"Contributions go to wrong account or held in suspense. Legal liability risk.",causes:["Old 11-digit member ID used","Spaces or dashes copied in","UAN from a different establishment"],fix:["Verify at passbook.epfindia.gov.in","Remove all spaces, hyphens, non-numeric characters","Cross-check your establishment's member register"]},
  EMPTY_NAME:        {code:"ECR-003",title:"Member name missing",            why:"EPFO uses the member name for identity verification against the UAN profile.",impact:"Record flagged for manual review — delays contribution credit.",causes:["Name column left blank in export","Excel formula error exported as empty"],fix:["Enter full name as on UAN-Aadhaar profile","Avoid special characters or trailing spaces"]},
  INVALID_NUM:       {code:"ECR-004",title:"Invalid numeric value",           why:"All wage fields must be plain whole integers. EPFO's parser fails the entire row on any invalid character.",impact:"Entire row rejected. Zero contributions processed.",causes:["₹ symbol left in value","Commas in numbers (1,500 → 1500)","Excel error (#REF!) exported as text","Decimal used (500.00 → 500)"],fix:["Remove ₹ symbols, commas, decimals","Use plain whole integers only","Use 0 for any field not applicable"]},
  EPF_EXCEEDS_GROSS: {code:"ECR-005",title:"EPF Wages exceed Gross Wages",   why:"EPF Wages are a subset of total salary. You cannot deduct PF on more than what was paid.",impact:"Row rejected. Data integrity issue in payroll.",causes:["Gross and EPF columns swapped","Only Basic entered as Gross but full wages as EPF"],fix:["Gross Wages = Basic + DA + HRA + all allowances","EPF Wages = Basic + DA only","EPF Wages ≤ Gross Wages always"]},
  EPS_CEILING:       {code:"ECR-006",title:"EPS Wages exceed ₹15,000",       why:"Under EPF & MP Act 1952, EPS contributions are capped at ₹15,000/month for Normal Pensioners.",impact:"Challan rejected. Overcontribution distorts pension calculations.",causes:["Full EPF wages copied to EPS without ₹15k cap","Salary crossed ₹15k and EPS not updated"],fix:["Set EPS Wages = min(EPF Wages, 15000)","If confirmed Higher Pensioner (SC 2022), mark as HP in this tool"]},
  EPS_EXCEEDS_EPF:   {code:"ECR-007",title:"EPS Wages exceed EPF Wages",     why:"Pension wages are a subset of PF wages — mathematically and legally impossible to exceed.",impact:"EPFO rejects outright. No exceptions.",causes:["EPF and EPS columns swapped","EPF wages reduced but EPS not updated"],fix:["EPS Wages = min(EPF Wages, 15000)","Fix EPF wages first, then recalculate EPS"]},
  EDLI:              {code:"ECR-008",title:"EDLI ≠ EPF Wages",               why:"EDLI insurance uses the same wage base as EPF. Both columns must always be identical.",impact:"Discrepancy complicates insurance claim processing for the employee's family.",causes:["EDLI not updated when EPF wages changed","Stale values from previous month"],fix:["Set EDLI Wages = EPF Wages always"]},
  EE_EPF:            {code:"ECR-009",title:"EE EPF contribution wrong",      why:"Employee EPF deduction must be exactly 12% of EPF Wages. Zero tolerance — even ₹1 difference is flagged.",impact:"Account credit mismatch. Affects PF corpus and interest over years.",causes:["Rounding on individual rows","Wrong % without EPFO approval","Wage revision not reflected"],fix:["EE EPF = ROUND(EPF Wages × 12 ÷ 100)","No independent rounding adjustments"]},
  EPS:               {code:"ECR-010",title:"EPS contribution incorrect",      why:"EPS = 8.33% of EPS Wages (max ₹1,250 normal). Higher Pensioner adds 1.16% above ₹15k. Directly funds the employee's monthly pension.",impact:"Incorrect EPS compounds over years, reducing retirement pension.",causes:["₹1,250 ceiling not applied","8.33% applied to EPF not EPS Wages","HP 1.16% surcharge missed"],fix:["Normal: EPS = MIN(ROUND(EPS Wages × 8.33%), 1250)","HP: EPS = ROUND(EPS × 8.33%) + ROUND((EPS − 15000) × 1.16%)"]},
  ER_PF:             {code:"ECR-011",title:"ER PF contribution wrong",       why:"ER PF = 3.67% of EPF Wages + differential. Ensures total employer share equals 12% of EPF Wages.",impact:"Challan total incorrect — reconciliation failure at EPFO.",causes:["Calculated as flat 12% minus EPS","EPS change not reflected","Rounding errors"],fix:["ER PF = ROUND(EPF×3.67%) + (MIN(ROUND(EPF×8.33%),cap) − EPS)","Recalculate whenever EPS wages or pensioner type changes"]},
  NCP:               {code:"ECR-012",title:"NCP Days — verify",              why:"Non-Contributing Period days affect EPS pensionable service calculation.",impact:"Incorrect NCP silently reduces future pension entitlement.",causes:["Employee joined/resigned mid-month","LWP leave","System auto-populated"],fix:["NCP = Total calendar days − Days wages were paid","Cross-check with HR attendance records"]},
  REFUND:            {code:"ECR-013",title:"Refund of Advances — verify",    why:"Non-zero refund means the employee is repaying a PF withdrawal.",impact:"Wrong refund = PF balance discrepancy.",causes:["PF advance under para 68-B/68-BB/68-J","Field should be 0 if no recovery"],fix:["Verify amount with accounts team","Set to 0 if no advance taken"]},
  NCP_RANGE:         {code:"ECR-014",title:"NCP Days out of range",          why:"NCP days must be 0–31.",impact:"Row rejected by EPFO.",causes:["Typo","System glitch"],fix:["Enter correct NCP days (0–31)"]},
  ZERO_WAGES:        {code:"ECR-015",title:"Gross Wages is zero",            why:"Zero gross wage means no salary recorded. Verify before submission.",impact:"Employee loses PF credit for the month if wages were actually paid.",causes:["Full month LWP","New joiner salary not processed","Data extraction error"],fix:["Confirm with payroll whether employee was paid","If genuine LWP — ensure HR records align"]},
  HP_LOW_EPS:        {code:"ECR-016",title:"Higher Pensioner, low EPS",      why:"Marked as Higher Pensioner but EPS Wages ≤ ₹15,000. The 1.16% surcharge only applies above ₹15k.",impact:"Possible mis-categorisation — may trigger audit query.",causes:["Incorrect pensioner type assigned","Low-wage employee in HP list"],fix:["Switch to Normal if not confirmed Higher Pensioner","Check EPFO joint option approval"]},
};
const hb = k => HB[k] || null;

// ─── VALIDATION ───────────────────────────────────────────────────────────────
function validate(fields, isHP=false) {
  const issues = [];
  const p = (sev,field,msg,sug,ff=null,fv=null,hk=null) =>
    issues.push({severity:sev,field,message:msg,suggestion:sug,fixField:ff,fixedValue:fv,hbKey:hk});

  if (fields.length !== N) {
    p("red","Structure",`Expected ${N} fields, found ${fields.length}.`,"Check all #~# separators.",null,null,"STRUCTURE");
    return issues;
  }
  const v = {
    uan:fields[0]?.trim(), memberName:fields[1]?.trim(),
    grossWages:parseFloat(fields[2]), epfWages:parseFloat(fields[3]),
    epsWages:parseFloat(fields[4]),   edliWages:parseFloat(fields[5]),
    epfContrib:parseFloat(fields[6]), epsContrib:parseFloat(fields[7]),
    epfEr:parseFloat(fields[8]),      ncp:parseFloat(fields[9]),
    refunds:parseFloat(fields[10]),
  };

  if (!v.uan || !/^\d{12}$/.test(v.uan))
    p("red","UAN",`"${v.uan}" is not a valid 12-digit UAN.`,"Correct to a 12-digit number.",null,null,"UAN");
  if (!v.memberName)
    p("red","Member Name","Member name is empty.","Enter the employee's full name.",null,null,"EMPTY_NAME");

  const numCols = [
    {key:"grossWages",label:"Gross Wages",val:v.grossWages,src:fields[2]},
    {key:"epfWages",  label:"EPF Wages",  val:v.epfWages,  src:fields[3]},
    {key:"epsWages",  label:"EPS Wages",  val:v.epsWages,  src:fields[4]},
    {key:"edliWages", label:"EDLI Wages", val:v.edliWages, src:fields[5]},
    {key:"epfContrib",label:"EE EPF",     val:v.epfContrib,src:fields[6]},
    {key:"epsContrib",label:"EPS Contrib",val:v.epsContrib,src:fields[7]},
    {key:"epfEr",     label:"ER PF",      val:v.epfEr,     src:fields[8]},
    {key:"ncp",       label:"NCP Days",   val:v.ncp,       src:fields[9]},
    {key:"refunds",   label:"Refund",     val:v.refunds,   src:fields[10]},
  ];
  for (const f of numCols) {
    if (isNaN(f.val))
      p("red",f.label,`"${f.src?.trim()}" is not a valid number.`,"Use a plain integer (0 if not applicable).",f.key,"0","INVALID_NUM");
    else if (f.val < 0)
      p("red",f.label,`${f.label} cannot be negative.`,"Set to 0 or a positive value.",f.key,"0","INVALID_NUM");
  }
  if (issues.some(i => i.severity==="red")) return issues;

  if (v.ncp > 0)
    p("medium","NCP Days",`NCP Days = ${v.ncp} — employee had non-contributing days.`,"Verify against attendance records.",null,null,"NCP");
  if (v.refunds > 0)
    p("medium","Refund Advances",`Refund of Advances = ₹${v.refunds}.`,"Confirm with accounts team.",null,null,"REFUND");
  if (v.epfWages > v.grossWages)
    p("red","EPF Wages",`EPF Wages (₹${v.epfWages}) > Gross Wages (₹${v.grossWages}).`,"Set EPF Wages ≤ Gross Wages.","epfWages",String(v.grossWages),"EPF_EXCEEDS_GROSS");
  if (!isHP && v.epsWages > 15000)
    p("red","EPS Wages",`EPS Wages (₹${v.epsWages}) exceeds ₹15,000 ceiling.`,"Cap at ₹15,000 or mark as Higher Pensioner.","epsWages","15000","EPS_CEILING");
  if (v.epsWages > v.epfWages)
    p("red","EPS Wages",`EPS Wages (₹${v.epsWages}) > EPF Wages (₹${v.epfWages}).`,"Set EPS Wages ≤ EPF Wages.","epsWages",String(Math.min(v.epfWages,isHP?v.epfWages:15000)),"EPS_EXCEEDS_EPF");
  if (isHP && v.epsWages <= 15000)
    p("medium","EPS Wages","Marked as Higher Pensioner but EPS Wages ≤ ₹15,000.","Verify pensioner category.",null,null,"HP_LOW_EPS");
  if (v.edliWages !== v.epfWages)
    p("medium","EDLI Wages",`EDLI (₹${v.edliWages}) ≠ EPF Wages (₹${v.epfWages}).`,"Set EDLI = EPF Wages.","edliWages",String(v.epfWages),"EDLI");
  if (v.grossWages === 0)
    p("medium","Gross Wages","Gross Wages = ₹0. Verify payroll.","Check payroll records.",null,null,"ZERO_WAGES");

  const expEE  = Math.round(v.epfWages * 0.12);
  const expEPS = isHP && v.epsWages > 15000
    ? Math.round(v.epsWages*8.33/100) + Math.round((v.epsWages-15000)*1.16/100)
    : Math.min(Math.round(v.epsWages*8.33/100), 1250);
  const epsIfFullEPF = Math.min(Math.round(v.epfWages*8.33/100), isHP ? Infinity : 1250);
  const diff   = epsIfFullEPF - expEPS;
  const expER  = Math.round(v.epfWages*3.67/100) + diff;

  if (v.epfContrib !== expEE)
    p("red","EE EPF",`Found ₹${v.epfContrib}, expected ₹${expEE} (12% of ₹${v.epfWages}).`,`Set to ₹${expEE}.`,"epfContrib",String(expEE),"EE_EPF");
  if (v.epsContrib !== expEPS)
    p("red","EPS Contribution",`Found ₹${v.epsContrib}, expected ₹${expEPS}.`,`Set to ₹${expEPS}.`,"epsContrib",String(expEPS),"EPS");
  if (v.epfEr !== expER)
    p("red","ER PF",`Found ₹${v.epfEr}, expected ₹${expER} (3.67%×₹${v.epfWages}=₹${Math.round(v.epfWages*3.67/100)}+diff ₹${diff}).`,`Set to ₹${expER}.`,"epfEr",String(expER),"ER_PF");
  if (!isNaN(v.ncp) && v.ncp > 31)
    p("red","NCP Days",`NCP Days (${v.ncp}) must be 0–31.`,"Correct to valid range.","ncp","0","NCP_RANGE");

  return issues;
}

function parseAll(text, hpSet=new Set()) {
  return text.split(/\r?\n/).map((line, i) => {
    const t = line.trim();
    if (!t) return null;
    const fields = t.split(DELIM);
    const uan    = fields[0]?.trim();
    const isHP   = hpSet.has(uan);
    const issues = validate(fields, isHP);
    return {
      lineNum: i+1, raw: line, fields, issues, isHP,
      hasRed:    issues.some(x => x.severity === "red"),
      hasMedium: issues.some(x => x.severity === "medium"),
    };
  }).filter(Boolean);
}

function applyAllFixes(txt, hpSet=new Set()) {
  return txt.split(/\r?\n/).map(line => {
    const t = line.trim();
    if (!t) return line;
    const fields = t.split(DELIM);
    if (fields.length !== N) return line;
    const uan    = fields[0]?.trim();
    const issues = validate(fields, hpSet.has(uan));
    const upd    = [...fields];
    for (const iss of issues)
      if (iss.fixField && iss.fixedValue !== null) {
        const fi = FIELDS.findIndex(f => f.key === iss.fixField);
        if (fi !== -1) upd[fi] = iss.fixedValue;
      }
    return upd.join(DELIM);
  }).join("\n");
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
function exportCSV(rows, fileName) {
  const now = new Date().toLocaleString("en-IN");
  const errors = rows.flatMap(r => r.issues.map(iss => ({
    line: r.lineNum, uan: r.fields[0]?.trim()||"",
    member: r.fields[1]?.trim()||"",
    severity: iss.severity, field: iss.field,
    message: iss.message, suggestion: iss.suggestion,
    code: iss.hbKey||"",
  })));
  const header = ["Line","UAN","Member Name","Severity","Field","Message","Suggestion","Code"];
  const csv = [
    `EPFO ECR Validation Report`,
    `File: ${fileName}`,
    `Date: ${now}`,
    `Total Records: ${rows.length}`,
    `Errors: ${rows.reduce((s,r)=>s+r.issues.filter(i=>i.severity==="red").length,0)}`,
    `Flags: ${rows.reduce((s,r)=>s+r.issues.filter(i=>i.severity==="medium").length,0)}`,
    "",
    header.join(","),
    ...errors.map(e => [e.line,e.uan,`"${e.member}"`,e.severity,e.field,`"${e.message}"`,`"${e.suggestion}"`,e.code].join(","))
  ].join("\n");
  const blob = new Blob([csv], {type:"text/csv"});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `ECR_Validation_${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
  trackEvent("validation_report_downloaded", {
    report_format: "csv",
    ...buildValidationAnalytics(rows),
  });
}

function exportPDF(rows, fileName) {
  const now   = new Date().toLocaleString("en-IN");
  const totalRed = rows.reduce((s,r)=>s+r.issues.filter(i=>i.severity==="red").length,0);
  const totalAmber = rows.reduce((s,r)=>s+r.issues.filter(i=>i.severity==="medium").length,0);
  const errRows = rows.filter(r=>r.hasRed||r.hasMedium);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>ECR Validation Report</title>
  <style>
    body{font-family:'Arial',sans-serif;font-size:12px;color:#0A0A0A;background:#F5F0E8;margin:0;padding:24px;}
    h1{font-size:22px;font-weight:900;border-bottom:3px solid #0A0A0A;padding-bottom:8px;margin-bottom:4px;}
    .meta{font-size:11px;color:#6B6760;margin-bottom:20px;}
    .stats{display:flex;gap:16px;margin-bottom:24px;}
    .stat{border:2px solid #0A0A0A;padding:10px 18px;background:#FAFAF7;min-width:80px;}
    .stat-n{font-size:28px;font-weight:900;} .stat-l{font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#6B6760;}
    .stat.red .stat-n{color:#CC2222;} .stat.amber .stat-n{color:#C96800;} .stat.green .stat-n{color:#00AA4E;}
    table{width:100%;border-collapse:collapse;margin-top:16px;}
    th{background:#0A0A0A;color:#F5F0E8;font-size:9px;text-transform:uppercase;letter-spacing:0.06em;padding:6px 8px;text-align:left;}
    td{border-bottom:1px solid #D8D5CF;padding:6px 8px;font-size:11px;vertical-align:top;}
    tr:nth-child(even)td{background:#F9F7F2;}
    .err{color:#CC2222;font-weight:700;} .flag{color:#C96800;font-weight:700;}
    .code{font-family:monospace;font-size:10px;color:#A8A49C;}
    .disclaimer{margin-top:32px;border:2px solid #0A0A0A;padding:12px;font-size:10px;color:#6B6760;background:#FFFBE6;}
    @media print{body{background:white;}button{display:none;}}
  </style></head><body>
  <h1>EPFO ECR VALIDATION REPORT</h1>
  <div class="meta">File: <b>${fileName}</b> &nbsp;|&nbsp; Generated: ${now} &nbsp;|&nbsp; Unofficial tool — not affiliated with EPFO</div>
  <div class="stats">
    <div class="stat"><div class="stat-n">${rows.length}</div><div class="stat-l">Total Records</div></div>
    <div class="stat red"><div class="stat-n">${totalRed}</div><div class="stat-l">Errors</div></div>
    <div class="stat amber"><div class="stat-n">${totalAmber}</div><div class="stat-l">Flags</div></div>
    <div class="stat green"><div class="stat-n">${rows.filter(r=>!r.hasRed&&!r.hasMedium).length}</div><div class="stat-l">Clean Rows</div></div>
  </div>
  ${errRows.length===0
    ? '<p style="color:#00AA4E;font-weight:900;font-size:16px;">✓ ALL ROWS CLEAN — NO ISSUES FOUND</p>'
    : `<table><thead><tr><th>Line</th><th>UAN</th><th>Member</th><th>Severity</th><th>Field</th><th>Issue</th><th>Fix</th><th>Code</th></tr></thead><tbody>
    ${errRows.flatMap(row=>row.issues.map(iss=>`
      <tr>
        <td>${row.lineNum}</td>
        <td style="font-family:monospace">${row.fields[0]?.trim()||""}</td>
        <td>${row.fields[1]?.trim()||""}</td>
        <td class="${iss.severity==="red"?"err":"flag"}">${iss.severity==="red"?"ERROR":"FLAG"}</td>
        <td><b>${iss.field}</b></td>
        <td>${iss.message}</td>
        <td>${iss.suggestion}</td>
        <td class="code">${iss.hbKey||""}</td>
      </tr>`)).join("")}
    </tbody></table>`}
  <div class="disclaimer"><b>DISCLAIMER:</b> This is an unofficial validation tool not affiliated with or endorsed by EPFO or the Government of India. Results are indicative only. Employers remain solely responsible for verifying all ECR data against official EPFO guidelines before submission. No legal liability is accepted for errors, omissions, or losses arising from use of this tool.</div>
  </body></html>`;
  const w = window.open("","_blank");
  trackEvent("validation_report_downloaded", {
    report_format: "pdf",
    ...buildValidationAnalytics(rows),
  });
  w.document.write(html); w.document.close(); setTimeout(()=>w.print(),400);
}

// ─── PRIMITIVE COMPONENTS ─────────────────────────────────────────────────────

function Tx({style={}, children, ...rest}) {
  // Textured wrapper — adds noise + halftone layered backgrounds
  return (
    <div style={{
      backgroundImage: `${NOISE_SVG}, ${HALFTONE}`,
      backgroundBlendMode: "multiply",
      ...style
    }} {...rest}>
      {children}
    </div>
  );
}

function BBtn({children, onClick, variant="ink", size="md", disabled=false, style={}}) {
  const [hov, setHov] = useState(false);
  const [act, setAct] = useState(false);
  const base = {
    ink:    {bg:B.ink,     color:B.cream,   border:`2px solid ${B.ink}`},
    green:  {bg:B.green,   color:B.white,   border:`2px solid ${B.greenDk}`},
    teal:   {bg:B.teal,    color:B.ink,     border:`2px solid ${B.ink}`},
    ghost:  {bg:"transparent", color:B.ink, border:`2px solid ${B.ink}`},
    red:    {bg:B.red,     color:B.white,   border:`2px solid ${B.redDk}`},
  }[variant] || {bg:B.ink, color:B.cream, border:`2px solid ${B.ink}`};
  const pad = {sm:"5px 12px", md:"8px 18px", lg:"11px 26px"}[size] || "8px 18px";
  const fs  = {sm:11, md:13, lg:14}[size] || 13;
  return (
    <button
      onClick={onClick} disabled={disabled}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>{setHov(false);setAct(false);}}
      onMouseDown={()=>setAct(true)}  onMouseUp={()=>setAct(false)}
      style={{
        background: disabled ? B.grey1 : base.bg,
        color: disabled ? B.grey3 : base.color,
        border: disabled ? `2px solid ${B.grey2}` : base.border,
        borderRadius: 0,
        padding: pad, cursor: disabled ? "default" : "pointer",
        fontFamily: FH, fontWeight: 800, fontSize: fs,
        letterSpacing: "0.04em", textTransform: "uppercase",
        boxShadow: disabled ? "none" : act ? "none" : hov ? SHADOW : SHADOW_SM,
        transform: act ? "translate(2px,2px)" : "none",
        transition: "box-shadow 0.06s, transform 0.06s",
        display: "inline-flex", alignItems: "center", gap: 6,
        ...style
      }}>
      {children}
    </button>
  );
}

function Tag({text, variant="ink"}) {
  const v = {
    ink:    {bg:B.ink,    color:B.cream},
    red:    {bg:B.red,    color:B.white},
    orange: {bg:B.orange, color:B.white},
    green:  {bg:B.green,  color:B.white},
    teal:   {bg:B.teal,   color:B.ink},
    grey:   {bg:B.grey2,  color:B.ink},
  }[variant] || {bg:B.ink, color:B.cream};
  return (
    <span style={{
      background:v.bg, color:v.color,
      fontFamily:FH, fontWeight:900, fontSize:9,
      letterSpacing:"0.1em", textTransform:"uppercase",
      padding:"2px 8px", border:`1.5px solid ${B.ink}`, borderRadius:0,
      display:"inline-block",
    }}>{text}</span>
  );
}

function TurtleBar({msg}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:0,background:B.greenLt,border:`2px solid ${B.ink}`,borderLeft:`6px solid ${B.green}`,padding:"8px 12px"}}>
      <span style={{fontSize:22,marginRight:10,flexShrink:0}}>🐢</span>
      <div style={{fontFamily:FB,fontSize:12,color:B.ink,lineHeight:1.6,flex:1}}>
        <strong style={{fontFamily:FH,fontWeight:800}}>Mr. Turtle: </strong>{msg}
      </div>
    </div>
  );
}

function Tip({text,children}) {
  const [show, setShow] = useState(false);
  return (
    <span style={{position:"relative",display:"inline-block"}}
      onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)}>
      {children}
      {show && (
        <div style={{
          position:"absolute",bottom:"calc(100% + 6px)",left:0,zIndex:99,
          background:B.ink,color:B.cream,
          fontFamily:FB,fontSize:10,lineHeight:1.6,
          padding:"8px 11px",border:`2px solid ${B.ink}`,
          boxShadow:SHADOW,width:220,whiteSpace:"pre-wrap",
        }}>{text}</div>
      )}
    </span>
  );
}

// ─── DEADLINE WIDGET ──────────────────────────────────────────────────────────
function DeadlineWidget() {
  const today = new Date();
  const yr = today.getFullYear(), mo = today.getMonth();
  const next15 = new Date(today.getDate() <= 15 ? yr : (mo===11?yr+1:yr), mo===11&&today.getDate()>15?0:mo+(today.getDate()>15?1:0), 15);
  const days = Math.ceil((next15 - today) / 86400000);
  const urgent = days <= 3 ? "red" : days <= 7 ? "orange" : "green";
  const [bg,bc,txt] = urgent==="red"?[B.redLt,B.red,"URGENT"]:urgent==="orange"?[B.orangeLt,B.orange,"SOON"]:[B.greenLt,B.greenDk,"ON TRACK"];
  return (
    <div style={{display:"flex",alignItems:"center",gap:12,background:bg,border:`2px solid ${bc}`,padding:"8px 14px",boxShadow:`2px 2px 0 ${bc}`}}>
      <div>
        <div style={{fontFamily:FH,fontSize:22,fontWeight:900,color:bc,lineHeight:1}}>{days}</div>
        <div style={{fontFamily:FH,fontSize:8,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",color:bc}}>DAYS</div>
      </div>
      <div>
        <div style={{fontFamily:FH,fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",color:bc}}>{txt}</div>
        <div style={{fontFamily:FB,fontSize:11,color:B.grey4}}>ECR due 15th of month</div>
      </div>
      <Tag text={`${days}D`} variant={urgent==="red"?"red":urgent==="orange"?"orange":"green"}/>
    </div>
  );
}

// ─── HANDBOOK CARD ────────────────────────────────────────────────────────────
function HandbookCard({hbKey}) {
  const [open, setOpen] = useState(false);
  const e = hb(hbKey);
  if (!e) return null;
  return (
    <div style={{marginTop:8}}>
      <button onClick={()=>setOpen(o=>!o)}
        style={{
          width:"100%", background:open?B.ink:B.grey1, color:open?"#fff":B.ink,
          border:BORDER, padding:"6px 10px", cursor:"pointer",
          fontFamily:FH, fontSize:11, fontWeight:800, textAlign:"left",
          display:"flex", alignItems:"center", gap:8, letterSpacing:"0.05em",
          boxShadow:open?"none":SHADOW_SM, textTransform:"uppercase",
        }}>
        <span style={{fontSize:10}}>{open?"▲":"▼"}</span>
        <span>HANDBOOK — {e.code}</span>
        <span style={{marginLeft:"auto",opacity:0.6}}>{e.title}</span>
      </button>
      {open && (
        <div style={{border:BORDER,borderTop:"none",background:B.white,padding:14,display:"flex",flexDirection:"column",gap:10,backgroundImage:NOISE_SVG}}>
          <div style={{fontFamily:FH,fontSize:13,fontWeight:900,color:B.ink,borderBottom:BORDER,paddingBottom:8,textTransform:"uppercase",letterSpacing:"0.03em"}}>{e.title}</div>
          <div>
            <div style={{fontFamily:FH,fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",color:B.grey4,marginBottom:4}}>WHY THIS MATTERS</div>
            <div style={{fontFamily:FB,fontSize:12,color:B.ink,lineHeight:1.7}}>{e.why}</div>
          </div>
          <div style={{background:B.redLt,border:`2px solid ${B.red}`,padding:"8px 12px"}}>
            <div style={{fontFamily:FH,fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",color:B.red,marginBottom:4}}>⚠ IMPACT IF UNFIXED</div>
            <div style={{fontFamily:FB,fontSize:12,color:B.red,lineHeight:1.6}}>{e.impact}</div>
          </div>
          <div>
            <div style={{fontFamily:FH,fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",color:B.grey4,marginBottom:5}}>COMMON CAUSES</div>
            {e.causes.map((c,i) => (
              <div key={i} style={{display:"flex",gap:8,marginBottom:4,fontFamily:FB,fontSize:11,color:B.ink,lineHeight:1.5}}>
                <span style={{color:B.orange,fontWeight:900,flexShrink:0}}>→</span><span>{c}</span>
              </div>
            ))}
          </div>
          <div style={{background:B.greenLt,border:`2px solid ${B.greenDk}`,padding:"8px 12px"}}>
            <div style={{fontFamily:FH,fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",color:B.greenDk,marginBottom:5}}>HOW TO FIX</div>
            {e.fix.map((f,i) => (
              <div key={i} style={{display:"flex",gap:8,marginBottom:4,fontFamily:FB,fontSize:11,color:B.greenDk,lineHeight:1.5}}>
                <span style={{fontWeight:900,flexShrink:0}}>{i+1}.</span><span>{f}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ISSUE CARD ───────────────────────────────────────────────────────────────
function IssueCard({iss, lineNum, onFix}) {
  const isRed = iss.severity === "red";
  return (
    <div style={{
      background:isRed?B.redLt:B.orangeLt,
      border:`2px solid ${isRed?B.red:B.orange}`,
      padding:12, marginBottom:8,
      boxShadow:`3px 3px 0 ${isRed?B.red:B.orange}`,
      backgroundImage:NOISE_SVG,
    }}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8,flexWrap:"wrap"}}>
        <Tag text={isRed?"✕ ERROR":"◆ FLAG"} variant={isRed?"red":"orange"}/>
        <span style={{fontFamily:FH,fontSize:12,fontWeight:900,color:B.ink}}>{iss.field}</span>
        {iss.hbKey && <span style={{fontFamily:FM,fontSize:10,color:B.grey4,marginLeft:"auto"}}>{HB[iss.hbKey]?.code||""}</span>}
      </div>
      <div style={{fontFamily:FB,fontSize:12,color:B.ink,lineHeight:1.7,marginBottom:7,background:B.white,border:`1.5px solid ${B.grey2}`,padding:"7px 10px"}}>
        {iss.message}
      </div>
      <div style={{fontFamily:FB,fontSize:11,color:B.grey4,marginBottom:iss.fixField?9:0}}>↳ {iss.suggestion}</div>
      {iss.fixField && iss.fixedValue !== null && (
        <BBtn
          onClick={()=>onFix(lineNum,iss.fixField,iss.fixedValue)}
          variant={isRed?"ink":"ink"} size="sm"
          style={{width:"100%",justifyContent:"center",marginBottom:iss.hbKey?7:0}}>
          APPLY FIX → {iss.fixedValue}
        </BBtn>
      )}
      <HandbookCard hbKey={iss.hbKey}/>
    </div>
  );
}

// ─── DISCLAIMER ───────────────────────────────────────────────────────────────
function Disclaimer({onClose}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(10,10,10,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <Tx style={{background:B.cream,border:`3px solid ${B.ink}`,boxShadow:SHADOW_LG,padding:28,maxWidth:540,width:"100%"}}>
        <div style={{fontFamily:FH,fontSize:20,fontWeight:900,textTransform:"uppercase",letterSpacing:"0.04em",borderBottom:BORDER,paddingBottom:10,marginBottom:14}}>
          LEGAL DISCLAIMER
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10,fontFamily:FB,fontSize:12,color:B.inkSoft,lineHeight:1.8,marginBottom:20}}>
          <p style={{margin:0}}>This ECR Validator is an <strong style={{color:B.ink}}>independent, unofficial tool</strong>. It is not affiliated with, endorsed by, or connected to the <strong style={{color:B.ink}}>Employees' Provident Fund Organisation (EPFO)</strong> or any government body.</p>
          <p style={{margin:0}}>Validation checks are based on publicly available EPF & MP Act 1952 provisions. <strong style={{color:B.ink}}>Contribution rates and rules are subject to change</strong> by government notification.</p>
          <p style={{margin:0}}>The tool does <strong style={{color:B.red}}>not guarantee accuracy</strong>. Employers remain solely responsible for verifying ECR data against official EPFO guidelines before submission. <strong style={{color:B.ink}}>No legal liability is accepted</strong> for errors, omissions, or losses from use of this tool.</p>
          <p style={{margin:0}}>All data is processed <strong style={{color:B.ink}}>entirely in your browser</strong> — nothing is transmitted to any server.</p>
        </div>
        <BBtn onClick={onClose} variant="green" size="lg" style={{width:"100%",justifyContent:"center"}}>
          I UNDERSTAND — CONTINUE
        </BBtn>
      </Tx>
    </div>
  );
}

// ─── GUIDED FIX MODE ─────────────────────────────────────────────────────────
function GuidedFixMode({rows, onFix, onClose}) {
  const allIssues = rows.flatMap(r =>
    r.issues.filter(i => i.severity==="red").map(iss => ({...iss, lineNum:r.lineNum, fields:r.fields}))
  );
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState(new Set());

  if (allIssues.length === 0) return (
    <div style={{position:"fixed",inset:0,background:"rgba(10,10,10,0.75)",zIndex:900,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <Tx style={{background:B.cream,border:`3px solid ${B.ink}`,boxShadow:SHADOW_LG,padding:32,maxWidth:420,textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:12}}>🐢</div>
        <div style={{fontFamily:FH,fontSize:22,fontWeight:900,textTransform:"uppercase",marginBottom:8}}>ALL ERRORS RESOLVED!</div>
        <div style={{fontFamily:FB,fontSize:13,color:B.grey4,marginBottom:20}}>Every row has been checked and corrected. Your ECR is ready.</div>
        <BBtn onClick={onClose} variant="green" size="lg" style={{width:"100%",justifyContent:"center"}}>BACK TO EDITOR</BBtn>
      </Tx>
    </div>
  );

  const cur = allIssues[idx];
  const pct = Math.round((done.size / allIssues.length) * 100);

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(10,10,10,0.75)",zIndex:900,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <Tx style={{background:B.cream,border:`3px solid ${B.ink}`,boxShadow:SHADOW_LG,padding:24,maxWidth:500,width:"100%",display:"flex",flexDirection:"column",gap:14,maxHeight:"90vh",overflowY:"auto"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{fontFamily:FH,fontSize:14,fontWeight:900,textTransform:"uppercase",letterSpacing:"0.05em"}}>GUIDED FIX MODE</div>
          <BBtn onClick={onClose} variant="ghost" size="sm">✕ EXIT</BBtn>
        </div>

        {/* Progress */}
        <div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{fontFamily:FH,fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",color:B.grey4}}>{done.size} OF {allIssues.length} FIXED</span>
            <span style={{fontFamily:FH,fontSize:9,fontWeight:800,color:B.green}}>{pct}%</span>
          </div>
          <div style={{height:6,background:B.grey2,border:`1.5px solid ${B.ink}`}}>
            <div style={{height:"100%",background:B.green,width:`${pct}%`,transition:"width 0.3s"}}/>
          </div>
        </div>

        {/* Navigation */}
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <BBtn onClick={()=>setIdx(i=>Math.max(0,i-1))} disabled={idx===0} variant="ghost" size="sm">← PREV</BBtn>
          <div style={{flex:1,textAlign:"center",fontFamily:FH,fontSize:11,fontWeight:800,color:B.grey4}}>
            {idx+1} / {allIssues.length}
          </div>
          <BBtn onClick={()=>setIdx(i=>Math.min(allIssues.length-1,i+1))} disabled={idx===allIssues.length-1} variant="ghost" size="sm">NEXT →</BBtn>
        </div>

        {/* Current issue */}
        <div style={{background:B.white,border:BORDER,padding:14,boxShadow:SHADOW_SM}}>
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10}}>
            <Tag text="✕ ERROR" variant="red"/>
            <span style={{fontFamily:FH,fontSize:13,fontWeight:900}}>LINE {cur.lineNum} — {cur.field}</span>
            {done.has(idx) && <Tag text="✓ FIXED" variant="green"/>}
          </div>
          <div style={{fontFamily:FM,fontSize:11,background:B.grey1,border:`1.5px solid ${B.grey2}`,padding:"6px 10px",marginBottom:10,overflowX:"auto",whiteSpace:"nowrap",color:B.ink}}>
            {cur.fields?.join(" #~# ")}
          </div>
          <div style={{fontFamily:FB,fontSize:12,color:B.ink,lineHeight:1.7,marginBottom:8,background:B.redLt,border:`1.5px solid ${B.red}`,padding:"7px 10px"}}>
            {cur.message}
          </div>
          <div style={{fontFamily:FB,fontSize:11,color:B.grey4,marginBottom:12}}>↳ {cur.suggestion}</div>
          {cur.fixField && cur.fixedValue !== null && (
            <BBtn variant="green" size="md" style={{width:"100%",justifyContent:"center"}}
              onClick={()=>{
                onFix(cur.lineNum, cur.fixField, cur.fixedValue);
                setDone(prev=>new Set([...prev,idx]));
                if (idx < allIssues.length-1) setIdx(i=>i+1);
              }}>
              ✓ APPLY FIX → {cur.fixedValue}
            </BBtn>
          )}
        </div>

        <TurtleBar msg="Take your time — each fix you make directly protects an employee's future contributions."/>

        <HandbookCard hbKey={cur.hbKey}/>
      </Tx>
    </div>
  );
}

// ─── VALIDATION PROGRESS BAR ─────────────────────────────────────────────────
function ValidationProgress({rows}) {
  const total   = rows.length;
  const hasErr  = rows.filter(r=>r.hasRed).length;
  const hasFlag = rows.filter(r=>r.hasMedium&&!r.hasRed).length;
  const clean   = rows.filter(r=>!r.hasRed&&!r.hasMedium).length;
  const pct     = total > 0 ? Math.round((clean/total)*100) : 0;
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
        <span style={{fontFamily:FH,fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",color:B.grey4}}>VALIDATION PROGRESS</span>
        <span style={{fontFamily:FH,fontSize:11,fontWeight:900,color:pct===100?B.green:B.ink}}>{pct}% CLEAN</span>
      </div>
      <div style={{height:8,background:B.grey2,border:BORDER_SM,marginBottom:8,display:"flex",overflow:"hidden"}}>
        {clean > 0   && <div style={{height:"100%",background:B.green, width:`${(clean/total)*100}%`,transition:"width 0.3s"}}/>}
        {hasFlag > 0 && <div style={{height:"100%",background:B.orange,width:`${(hasFlag/total)*100}%`,transition:"width 0.3s"}}/>}
        {hasErr > 0  && <div style={{height:"100%",background:B.red,   width:`${(hasErr/total)*100}%`,transition:"width 0.3s"}}/>}
      </div>
      <div style={{display:"flex",gap:12}}>
        {[{c:B.red,n:hasErr,l:"ERRORS"},{c:B.orange,n:hasFlag,l:"FLAGS"},{c:B.green,n:clean,l:"CLEAN"},{c:B.ink,n:total,l:"TOTAL"}].map(s=>(
          <div key={s.l} style={{textAlign:"center",flex:1}}>
            <div style={{fontFamily:FH,fontSize:18,fontWeight:900,color:s.c,lineHeight:1}}>{s.n}</div>
            <div style={{fontFamily:FH,fontSize:8,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.07em",color:B.grey4}}>{s.l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  // Font injection — safe in useEffect, avoids module-level DOM crash
  useEffect(() => {
    if (!document.getElementById("ecr-fonts")) {
      const lnk = document.createElement("link");
      lnk.id = "ecr-fonts"; lnk.rel = "stylesheet";
      lnk.href = "https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap";
      document.head.appendChild(lnk);
    }
  }, []);

  const [stage, setStage]           = useState("disclaimer");
  const [text, setText]             = useState("");
  const [fileName, setFileName]     = useState("ecr.txt");
  const [selLine, setSelLine]       = useState(null);
  const [hpSet, setHpSet]           = useState(new Set());
  const [dragOver, setDragOver]     = useState(false);
  const [pasteMode, setPasteMode]   = useState(false);
  const [pasteText, setPasteText]   = useState("");
  const [copied, setCopied]         = useState(false);
  const [guidedMode, setGuidedMode] = useState(false);
  const [showDisc, setShowDisc]     = useState(false);

  const taRef  = useRef();
  const gutRef = useRef();
  const fileInputRef = useRef(null);
  const guidedModeTrackedRef = useRef(false);

  // Core derived state
  const rows   = useMemo(() => parseAll(text, hpSet), [text, hpSet]);
  const rowMap = useMemo(() => Object.fromEntries(rows.map(r => [r.lineNum, r])), [rows]);
  const lines  = text.split("\n");
  const selRow = selLine ? rowMap[selLine] : null;

  const totalRed    = rows.reduce((s,r) => s + r.issues.filter(i=>i.severity==="red").length, 0);
  const totalOrange = rows.reduce((s,r) => s + r.issues.filter(i=>i.severity==="medium").length, 0);
  const cleanCount  = rows.filter(r => !r.hasRed && !r.hasMedium).length;
  const allClean    = totalRed === 0 && totalOrange === 0 && rows.length > 0;

  // Gutter scroll sync
  const syncScroll = useCallback(() => {
    if (gutRef.current && taRef.current)
      gutRef.current.scrollTop = taRef.current.scrollTop;
  }, []);

  // Jump textarea to selected line
  useEffect(() => {
    if (!selLine || !taRef.current) return;
    taRef.current.scrollTop = (selLine - 1) * 22 - 80;
  }, [selLine]);

  useEffect(() => {
    trackPageView(stage === "editor" ? "ECR Editor" : "ECR Upload", `/${stage}`);
  }, [stage]);

  useEffect(() => {
    if (!guidedMode) {
      guidedModeTrackedRef.current = false;
      return;
    }
    if (guidedModeTrackedRef.current) return;

    guidedModeTrackedRef.current = true;
    trackEvent("guided_fix_started", buildValidationAnalytics(rows));
  }, [guidedMode, rows]);

  const loadText = (t, name="ecr.txt", source="unknown") => {
    const normalizedText = t.trimEnd();
    const parsedRows = parseAll(normalizedText, hpSet);

    setText(normalizedText);
    setFileName(name);
    setStage("editor");
    setPasteMode(false);
    setPasteText("");
    setSelLine(null);

    trackEvent("ecr_loaded", {
      source,
      ...buildValidationAnalytics(parsedRows),
    });
  };

    const handleFile = async (input) => {
    if (!input) return;

    let file = null;
    if (input instanceof File || input instanceof Blob) {
      file = input;
    } else if (input?.target?.files?.length) {
      file = input.target.files[0];
    } else if (input?.dataTransfer?.files?.length) {
      file = input.dataTransfer.files[0];
    } else if (input && input[0] instanceof File) {
      file = input[0];
    }

    if (!file) return;
    const name = file.name || "ecr.txt";

    // 1. Try modern Blob.text() API
    if (typeof file.text === "function") {
      try {
        const text = await file.text();
        if (typeof text === "string") {
          loadText(text, name, "file_upload");
          return;
        }
      } catch (err) {
        console.warn("file.text() failed, trying FileReader", err);
      }
    }

    // 2. Fallback to FileReader API with ArrayBuffer / UTF-8 decoding
    try {
      const reader = new FileReader();
      reader.onload = e => {
        let res = e.target?.result;
        if (res instanceof ArrayBuffer) {
          try {
            res = new TextDecoder("utf-8").decode(res);
          } catch {
            res = new TextDecoder("windows-1252").decode(res);
          }
        }
        if (typeof res === "string") {
          loadText(res, name, "file_upload");
        }
      };
      reader.onerror = () => {
        // Fallback: read as ArrayBuffer
        try {
          const abReader = new FileReader();
          abReader.onload = ev => {
            const buf = ev.target?.result;
            if (buf) {
              const str = new TextDecoder("utf-8").decode(buf);
              loadText(str, name, "file_upload");
            }
          };
          abReader.readAsArrayBuffer(file);
        } catch (fErr) {
          console.error("FileReader fallback failed", fErr);
        }
      };
      reader.readAsText(file);
    } catch (err) {
      console.error("handleFile error", err);
    }
  };

  const fixAll = () => setText(prev => {
    const beforeRows = parseAll(prev, hpSet);
    trackEvent("fix_all_applied", buildValidationAnalytics(beforeRows));
    return applyAllFixes(prev, hpSet);
  });

  const download = () => setText(prev => {
    const blob = new Blob([prev], {type:"text/plain"});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `FIXED_${fileName}`; a.click();
    URL.revokeObjectURL(url);
    trackEvent("fixed_ecr_downloaded", buildValidationAnalytics(rows));
    return prev;
  });

  const copyText = async () => {
    await navigator.clipboard.writeText(text);
    trackEvent("fixed_ecr_copied", buildValidationAnalytics(rows));
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const toggleHP = uan => setHpSet(prev => {
    const n = new Set(prev);
    const enabled = !n.has(uan);
    if (enabled) n.add(uan);
    else n.delete(uan);
    trackEvent("higher_pensioner_toggled", { enabled });
    return n;
  });

  const applyFix = (lineNum, fixField, fixedValue) => {
    setText(prev => {
      const ls  = prev.split("\n");
      const idx = lineNum - 1;
      if (idx < 0 || idx >= ls.length) return prev;
      const fields = ls[idx].split(DELIM);
      const fi     = FIELDS.findIndex(f => f.key === fixField);
      if (fi !== -1) {
        fields[fi] = fixedValue; ls[idx] = fields.join(DELIM);
        trackEvent("single_fix_applied", { field: fixField });
      }
      return ls.join("\n");
    });
  };

  // ── DISCLAIMER ──────────────────────────────────────────────────────────────
  if (stage === "disclaimer") return <Disclaimer onClose={() => setStage("upload")}/>;

  // ── UPLOAD ──────────────────────────────────────────────────────────────────
  if (stage === "upload") return (
    <Tx style={{minHeight:"100vh",background:B.cream,fontFamily:FB,padding:"0 0 40px",overflowY:"auto"}}>

      {/* Top stripe */}
      <div style={{background:B.ink,padding:"12px 24px",display:"flex",alignItems:"center",gap:16}}>
        <div style={{width:8,height:28,background:B.green}}/>
        <div>
          <div style={{fontFamily:FH,fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.14em",color:B.grey3,marginBottom:2}}>EPFO · ECR FORMAT 2.0 · UNOFFICIAL TOOL</div>
          <div style={{fontFamily:FH,fontSize:20,fontWeight:900,color:B.cream,letterSpacing:"0.04em"}}>EPFO ECR FILE VALIDATOR</div>
        </div>
        <div style={{marginLeft:"auto"}}>
          <DeadlineWidget/>
        </div>
      </div>

      {/* Hero */}
      <div style={{maxWidth:760,margin:"0 auto",padding:"40px 24px 0"}}>

        {/* Title block */}
        <div style={{borderBottom:`3px solid ${B.ink}`,paddingBottom:24,marginBottom:32}}>
          <div style={{display:"inline-block",background:B.green,color:B.white,fontFamily:FH,fontWeight:900,fontSize:9,textTransform:"uppercase",letterSpacing:"0.12em",padding:"3px 10px",marginBottom:12}}>
            COMPLIANCE TOOL
          </div>
          <h1 style={{fontFamily:FH,fontSize:36,fontWeight:900,color:B.ink,margin:"0 0 12px",letterSpacing:"-0.01em",lineHeight:1.1}}>
            Validate your ECR<br/>before it's too late.
          </h1>
          <p style={{fontFamily:FB,fontSize:15,color:B.grey4,margin:0,lineHeight:1.7,maxWidth:480}}>
            Upload or paste your ECR text file. Every row is checked against EPF & MP Act rules — contributions, wages, UANs — and errors are flagged with fixes.
          </p>
        </div>

        {/* Three info panels */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:0,marginBottom:32,border:BORDER}}>
          {[
            {n:"16",  l:"Validation Checks", d:"Every statutory rule verified automatically"},
            {n:"ECR", l:"Format 2.0",        d:"#~# delimiter · 11 fields per row"},
            {n:"0",   l:"Data Sent",         d:"Runs entirely in your browser"},
          ].map((f,i) => (
            <div key={i} style={{padding:"18px 20px",borderRight:i<2?BORDER:"none",backgroundImage:NOISE_SVG,background:i===1?B.ink:B.white}}>
              <div style={{fontFamily:FH,fontSize:28,fontWeight:900,color:i===1?B.green:B.ink,lineHeight:1}}>{f.n}</div>
              <div style={{fontFamily:FH,fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.06em",color:i===1?B.grey3:B.ink,marginTop:2}}>{f.l}</div>
              <div style={{fontFamily:FB,fontSize:11,color:i===1?B.grey3:B.grey4,marginTop:4,lineHeight:1.5}}>{f.d}</div>
            </div>
          ))}
        </div>

        {/* Upload zone */}
        <div style={{border:`3px solid ${B.ink}`,boxShadow:SHADOW_LG,marginBottom:24}}>
          {/* Zone header */}
          <div style={{background:B.ink,padding:"10px 18px",display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:6,height:20,background:B.teal}}/>
            <span style={{fontFamily:FH,fontSize:13,fontWeight:900,color:B.cream,letterSpacing:"0.05em",textTransform:"uppercase"}}>UPLOAD ECR FILE</span>
          </div>

          {!pasteMode ? (
            <div
              onDrop={e=>{e.preventDefault();setDragOver(false);handleFile(e);}}
              onDragOver={e=>{e.preventDefault();setDragOver(true);}}
              onDragLeave={()=>setDragOver(false)}
              style={{
                padding:"44px 32px",textAlign:"center",
                background:dragOver?B.greenLt:B.cream,
                backgroundImage:dragOver?"none":HALFTONE,
                transition:"background 0.15s",
              }}>
              <div style={{fontFamily:FH,fontSize:28,fontWeight:900,color:dragOver?B.greenDk:B.ink,marginBottom:8,letterSpacing:"-0.01em",textTransform:"uppercase"}}>
                {dragOver ? "DROP IT." : "DRAG & DROP YOUR FILE"}
              </div>
              <div style={{fontFamily:FB,fontSize:12,color:B.grey4,marginBottom:24}}>
                .txt · delimiter <code style={{background:B.grey1,border:`1px solid ${B.grey2}`,padding:"1px 6px",fontFamily:FM,fontSize:11}}>#~#</code> · 11 fields per row
              </div>
              <div style={{display:"flex",gap:12,justifyContent:"center",alignItems:"center"}}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.ecr,text/plain,*/*"
                  style={{display:"none"}}
                  onChange={e => {
                    handleFile(e);
                    e.target.value = "";
                  }}
                />
                <BBtn onClick={() => fileInputRef.current?.click()} variant="ink" size="lg">
                  CHOOSE FILE
                </BBtn>
                <span style={{fontFamily:FH,fontSize:11,color:B.grey4,fontWeight:700}}>OR</span>
                <BBtn onClick={() => setPasteMode(true)} variant="ghost" size="lg">PASTE TEXT</BBtn>
              </div>
            </div>
          ) : (
            <div style={{padding:"22px 24px",background:B.white,backgroundImage:NOISE_SVG}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontFamily:FH,fontSize:12,fontWeight:900,textTransform:"uppercase",letterSpacing:"0.06em"}}>PASTE ECR CONTENT</div>
                <button onClick={()=>setPasteMode(false)} style={{background:"none",border:BORDER,color:B.ink,cursor:"pointer",fontSize:16,lineHeight:1,padding:"2px 8px",fontFamily:FH,fontWeight:900}}>✕</button>
              </div>
              <div style={{fontFamily:FB,fontSize:11,color:B.grey4,marginBottom:8}}>
                One row per line · fields separated by <code style={{background:B.grey1,border:`1px solid ${B.grey2}`,padding:"1px 5px",fontFamily:FM}}>#~#</code>
              </div>
              <textarea
                value={pasteText} onChange={e=>setPasteText(e.target.value)} autoFocus
                placeholder={"100123456789#~#BINOD#~#5810#~#5810#~#5810#~#5810#~#697#~#484#~#213#~#0#~#0"}
                style={{
                  width:"100%",minHeight:140,fontFamily:FM,fontSize:12,
                  background:B.cream,border:`2px solid ${B.ink}`,
                  padding:12,resize:"vertical",color:B.ink,
                  boxSizing:"border-box",outline:"none",lineHeight:1.8,
                  backgroundImage:NOISE_SVG,
                }}
              />
              <div style={{display:"flex",gap:10,marginTop:12}}>
                <BBtn onClick={()=>pasteText.trim()&&loadText(pasteText.trim(), "pasted-ecr.txt", "paste")} variant={pasteText.trim()?"green":"ghost"} size="lg" disabled={!pasteText.trim()} style={{flex:1,justifyContent:"center"}}>
                  OPEN IN EDITOR →
                </BBtn>
                <BBtn onClick={()=>{setPasteMode(false);setPasteText("");}} variant="ghost" size="md">CANCEL</BBtn>
              </div>
            </div>
          )}
        </div>

        {/* Mr. Turtle */}
        <TurtleBar msg="I'll check every row against the EPF & MP Act rules. Upload your file and I'll flag anything that needs attention — with step-by-step guidance on how to fix it."/>

        {/* Footer */}
        <div style={{marginTop:20,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontFamily:FB,fontSize:10,color:B.grey4}}>
            Unofficial tool · Not affiliated with EPFO · Results indicative only
          </div>
          <button onClick={()=>setShowDisc(true)} style={{background:"none",border:"none",fontFamily:FB,fontSize:10,color:B.grey4,cursor:"pointer",textDecoration:"underline",padding:0}}>
            View full disclaimer
          </button>
        </div>
      </div>

      {showDisc && <Disclaimer onClose={()=>setShowDisc(false)}/>}
    </Tx>
  );

  // ── EDITOR ──────────────────────────────────────────────────────────────────
  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",fontFamily:FB,background:B.cream,color:B.ink}}>
      {guidedMode && <GuidedFixMode rows={rows} onFix={applyFix} onClose={()=>setGuidedMode(false)}/>}
      {showDisc   && <Disclaimer onClose={()=>setShowDisc(false)}/>}

      {/* Top bar */}
      <div style={{flexShrink:0,background:B.ink,borderBottom:`3px solid ${B.ink}`,height:48,display:"flex",alignItems:"center",gap:0,padding:"0 0 0 0"}}>
        {/* Left accent */}
        <div style={{width:6,height:"100%",background:B.green,flexShrink:0}}/>
        <div style={{padding:"0 12px",display:"flex",alignItems:"center",gap:10,flex:1}}>
          <BBtn onClick={()=>{setStage("upload");setSelLine(null);}} variant="ghost" size="sm"
            style={{color:B.cream,borderColor:B.grey4}}>← BACK</BBtn>
          <div style={{width:1,height:20,background:B.grey4}}/>
          <span style={{fontFamily:FH,fontSize:13,fontWeight:900,color:B.cream,letterSpacing:"0.05em",textTransform:"uppercase"}}>ECR EDITOR</span>
          <code style={{fontFamily:FM,fontSize:10,color:B.grey3,background:B.grey4,padding:"1px 8px"}}>{fileName}</code>

          {/* Status chips */}
          <div style={{display:"flex",gap:5}}>
            {totalRed    > 0 && <Tag text={`✕ ${totalRed} ERR`}    variant="red"/>}
            {totalOrange > 0 && <Tag text={`◆ ${totalOrange} FLAG`} variant="orange"/>}
            {allClean        && <Tag text="✓ CLEAN"                 variant="green"/>}
            {rows.length === 0 && <Tag text="NO DATA" variant="grey"/>}
          </div>

          <div style={{flex:1}}/>

          {/* Actions */}
          {!allClean && rows.length > 0 && <BBtn onClick={()=>setGuidedMode(true)} variant="teal" size="sm">GUIDED FIX</BBtn>}
          {!allClean && rows.length > 0 && <BBtn onClick={fixAll} variant="green" size="sm">⚡ FIX ALL</BBtn>}
          <BBtn onClick={copyText} variant="ghost" size="sm" style={{color:copied?B.green:B.cream,borderColor:copied?B.green:B.grey4}}>
            {copied ? "✓ COPIED" : "COPY"}
          </BBtn>
          <BBtn onClick={download} variant="green" size="sm">↓ DOWNLOAD</BBtn>
          {rows.length > 0 && <BBtn onClick={()=>exportCSV(rows,fileName)} variant="ghost" size="sm" style={{color:B.grey3,borderColor:B.grey4}}>CSV</BBtn>}
          {rows.length > 0 && <BBtn onClick={()=>exportPDF(rows,fileName)} variant="ghost" size="sm" style={{color:B.grey3,borderColor:B.grey4}}>PDF</BBtn>}
        </div>
      </div>

      {/* Field legend strip */}
      <div style={{flexShrink:0,display:"flex",gap:0,overflowX:"auto",background:B.grey1,borderBottom:`2px solid ${B.ink}`,padding:"4px 42px",alignItems:"center"}}>
        {FIELDS.map((f,i) => (
          <div key={f.key} style={{display:"flex",alignItems:"center",gap:0,flexShrink:0}}>
            <Tip text={f.tt}>
              <span style={{
                fontSize:9,color:B.green,fontFamily:FM,background:B.ink,
                padding:"1px 4px",marginRight:2,cursor:"help",fontWeight:700,
              }}>F{i+1}</span>
              <span style={{fontSize:9,color:B.grey4,whiteSpace:"nowrap",marginRight:2,fontFamily:FH,fontWeight:700,cursor:"help",textTransform:"uppercase",letterSpacing:"0.04em"}}>{f.label}</span>
            </Tip>
            {i < FIELDS.length-1 && <span style={{color:B.grey3,fontSize:9,marginRight:5,fontFamily:FM}}>#~#</span>}
          </div>
        ))}
      </div>

      {/* Encourage bar */}
      {totalRed > 0 && (
        <div style={{flexShrink:0,background:B.greenLt,borderBottom:`2px solid ${B.ink}`,padding:"6px 14px",display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:16}}>🐢</span>
          <span style={{fontFamily:FB,fontSize:12,color:B.greenDk,lineHeight:1.5}}>
            <strong style={{fontFamily:FH,fontWeight:800}}>Mr. Turtle:</strong>{" "}
            Take it one row at a time. Each fix protects an employee's social security. You've got this.
          </span>
          <BBtn onClick={()=>setGuidedMode(true)} variant="ghost" size="sm" style={{marginLeft:"auto",flexShrink:0,borderColor:B.greenDk,color:B.greenDk}}>
            GUIDED MODE →
          </BBtn>
        </div>
      )}

      {/* Split pane */}
      <div style={{flex:1,display:"flex",overflow:"hidden"}}>

        {/* LEFT: editor with gutter */}
        <div style={{flex:1,display:"flex",overflow:"hidden",minWidth:0}}>
          {/* Gutter */}
          <div ref={gutRef}
            style={{width:40,flexShrink:0,background:B.grey1,borderRight:`2px solid ${B.ink}`,overflowY:"hidden",paddingTop:6}}>
            {lines.map((_,i) => {
              const ln    = i + 1;
              const row   = rowMap[ln];
              const isRed = row?.hasRed;
              const isAmb = row?.hasMedium && !row?.hasRed;
              const isSel = selLine === ln;
              return (
                <div key={i}
                  onClick={() => setSelLine(isSel ? null : ln)}
                  style={{
                    height:22, lineHeight:"22px", textAlign:"center",
                    fontSize:10, fontFamily:FM, userSelect:"none",
                    cursor:(isRed||isAmb)?"pointer":"default",
                    color: isSel?"#fff": isRed?B.red: isAmb?B.orange: B.grey3,
                    background: isSel ? B.green : "transparent",
                    borderLeft: isRed ? `3px solid ${B.red}` : isAmb ? `3px solid ${B.orange}` : "3px solid transparent",
                    fontWeight: 800,
                  }}>
                  {isRed ? "✕" : isAmb ? "◆" : ln}
                </div>
              );
            })}
          </div>

          {/* Main textarea */}
          <textarea
            ref={taRef}
            value={text}
            onChange={e => { setText(e.target.value); }}
            onScroll={syncScroll}
            onClick={e => {
              const ta = e.target;
              const ln = ta.value.substring(0, ta.selectionStart).split("\n").length;
              if (rowMap[ln]) setSelLine(ln);
            }}
            spellCheck={false}
            style={{
              flex:1,
              background:B.white,
              backgroundImage: NOISE_SVG,
              color:B.ink,
              fontFamily:FM, fontSize:12.5, lineHeight:"22px",
              border:"none", outline:"none",
              padding:"6px 14px",
              resize:"none", overflowY:"auto", whiteSpace:"pre",
            }}
          />
        </div>

        {/* RIGHT: inspection panel */}
        <div style={{
          width:360, flexShrink:0, display:"flex", flexDirection:"column",
          background:B.cream, borderLeft:`3px solid ${B.ink}`, overflow:"hidden",
          backgroundImage:NOISE_SVG,
        }}>

          {/* Panel header */}
          <div style={{
            padding:"12px 14px", borderBottom:`2px solid ${B.ink}`,
            flexShrink:0, background:B.grey1, backgroundImage:HALFTONE,
          }}>
            {selRow ? (
              <div>
                <div style={{fontFamily:FH,fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",color:B.grey4,marginBottom:3}}>REVIEWING · LINE {selLine}</div>
                <div style={{fontFamily:FH,fontSize:16,fontWeight:900,color:B.ink,textTransform:"uppercase"}}>{selRow.fields[1]?.trim() || "UNKNOWN MEMBER"}</div>
                <div style={{fontFamily:FM,fontSize:11,color:B.grey4,marginTop:2}}>{selRow.fields[0]?.trim()}</div>
              </div>
            ) : (
              <div>
                <div style={{fontFamily:FH,fontSize:16,fontWeight:900,color:B.ink,textTransform:"uppercase"}}>VALIDATION RESULTS</div>
                <div style={{fontFamily:FB,fontSize:11,color:B.grey4,marginTop:3}}>
                  {rows.length === 0
                    ? "Paste ECR data in the editor — validation is instant."
                    : rows.filter(r=>r.hasRed||r.hasMedium).length > 0
                      ? `${rows.filter(r=>r.hasRed||r.hasMedium).length} row(s) need attention — click ✕ or ◆`
                      : "All rows are clean — click any line to inspect."}
                </div>
              </div>
            )}
          </div>

          {/* Validation progress (when rows loaded, no selection) */}
          {rows.length > 0 && !selRow && (
            <div style={{padding:"12px 14px",borderBottom:`2px solid ${B.ink}`,flexShrink:0}}>
              <ValidationProgress rows={rows}/>
              {(totalRed > 0 || totalOrange > 0) && (
                <div style={{marginTop:10,background:B.redLt,border:`2px solid ${B.red}`,padding:"8px 12px",boxShadow:`2px 2px 0 ${B.red}`}}>
                  <div style={{fontFamily:FH,fontSize:11,fontWeight:900,color:B.red,textTransform:"uppercase"}}>
                    {totalRed} error{totalRed!==1?"s":""}{totalOrange>0?` · ${totalOrange} flag${totalOrange!==1?"s":""}`:""}
                  </div>
                  <div style={{fontFamily:FB,fontSize:11,color:B.grey4,marginTop:2}}>Click ✕ or ◆ in the gutter to inspect.</div>
                </div>
              )}
            </div>
          )}

          {/* Deadline (no selection, rows loaded) */}
          {!selRow && rows.length > 0 && (
            <div style={{padding:"10px 14px",borderBottom:`2px solid ${B.ink}`,flexShrink:0}}>
              <DeadlineWidget/>
            </div>
          )}

          {/* Scrollable content */}
          <div style={{flex:1,overflowY:"auto",padding:12,display:"flex",flexDirection:"column",gap:8}}>

            {/* Empty state */}
            {!selRow && rows.length === 0 && (
              <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14,padding:"32px 16px",textAlign:"center"}}>
                <div style={{fontSize:48,opacity:0.2}}>📋</div>
                <div style={{fontFamily:FH,fontSize:15,fontWeight:900,color:B.grey3,textTransform:"uppercase"}}>NO DATA YET</div>
                <div style={{fontFamily:FB,fontSize:12,color:B.grey4,lineHeight:1.7,maxWidth:220}}>
                  Paste your ECR rows into the text editor on the left. Validation runs automatically as you type.
                </div>
                <TurtleBar msg="Paste your ECR on the left and I'll validate every row instantly!"/>
              </div>
            )}

            {/* Selected row detail */}
            {selRow && (
              <>
                {/* HP toggle */}
                {(() => {
                  const uan = selRow.fields[0]?.trim();
                  if (!uan) return null;
                  const isHP = hpSet.has(uan);
                  return (
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:isHP?B.ink:B.grey1,border:`2px solid ${B.ink}`,padding:"9px 12px",boxShadow:SHADOW_SM}}>
                      <div>
                        <div style={{fontFamily:FH,fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",color:isHP?B.sage:B.grey4}}>PENSIONER TYPE</div>
                        <div style={{fontFamily:FB,fontSize:11,color:isHP?B.greenLt:B.grey4,marginTop:2}}>
                          {isHP ? "Higher Pensioner — 8.33% + 1.16% above ₹15k" : "Normal — EPS capped at ₹15,000/month"}
                        </div>
                      </div>
                      <BBtn onClick={()=>toggleHP(uan)} variant={isHP?"teal":"ghost"} size="sm" style={{marginLeft:10,flexShrink:0}}>
                        {isHP ? "HIGHER ✓" : "NORMAL"}
                      </BBtn>
                    </div>
                  );
                })()}

                {/* Field grid */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:0,border:BORDER}}>
                  {FIELDS.map((f,i) => {
                    const val = selRow.fields[f.pos]?.trim();
                    const bad = selRow.issues.some(iss=>iss.fixField===f.key&&iss.severity==="red");
                    const wrn = !bad && selRow.issues.some(iss=>iss.fixField===f.key&&iss.severity==="medium");
                    return (
                      <div key={f.key} style={{
                        background:bad?B.redLt:wrn?B.yellowLt:B.white,
                        borderBottom:`1.5px solid ${B.grey2}`,
                        borderRight:(i%2===0)?`1.5px solid ${B.grey2}`:"none",
                        padding:"5px 8px",
                        backgroundImage:NOISE_SVG,
                      }}>
                        <div style={{fontFamily:FH,fontSize:8,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.07em",color:bad?B.red:wrn?B.orange:B.grey4}}>{f.label}</div>
                        <div style={{fontFamily:FM,fontSize:12,fontWeight:700,color:bad?B.red:wrn?B.orange:B.ink,marginTop:1}}>
                          {val || <span style={{color:B.grey3}}>—</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Clean row */}
                {selRow.issues.length === 0 && (
                  <div style={{background:B.greenLt,border:`2px solid ${B.greenDk}`,padding:14,boxShadow:`2px 2px 0 ${B.greenDk}`,textAlign:"center"}}>
                    <div style={{fontFamily:FH,fontSize:16,fontWeight:900,textTransform:"uppercase",color:B.greenDk,marginBottom:6}}>✓ ROW IS CLEAN</div>
                    <div style={{fontFamily:FB,fontSize:12,color:B.greenDk}}>All fields check out. This employee's contributions are correct.</div>
                  </div>
                )}

                {/* Issue cards */}
                {selRow.issues.map((iss,i) => (
                  <IssueCard key={i} iss={iss} lineNum={selLine} onFix={applyFix}/>
                ))}

                <BBtn onClick={()=>setSelLine(null)} variant="ghost" size="sm" style={{width:"100%",justifyContent:"center",marginTop:4}}>
                  ← BACK TO ALL ISSUES
                </BBtn>
              </>
            )}

            {/* Issues list */}
            {!selRow && rows.length > 0 && !allClean && rows.filter(r=>r.hasRed||r.hasMedium).map(row => (
              <div key={row.lineNum}
                onClick={()=>setSelLine(row.lineNum)}
                style={{
                  background:B.white,border:`2px solid ${row.hasRed?B.red:B.orange}`,
                  padding:"10px 12px",cursor:"pointer",
                  boxShadow:`2px 2px 0 ${row.hasRed?B.red:B.orange}`,
                  backgroundImage:NOISE_SVG,transition:"transform 0.1s",
                }}
                onMouseEnter={e=>e.currentTarget.style.transform="translate(-1px,-1px)"}
                onMouseLeave={e=>e.currentTarget.style.transform=""}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:6}}>
                  <Tag text={row.hasRed?"✕ ERR":"◆ FLAG"} variant={row.hasRed?"red":"orange"}/>
                  <span style={{fontFamily:FH,fontSize:12,fontWeight:900,color:B.ink}}>LINE {row.lineNum}</span>
                  {row.isHP && <Tag text="HP" variant="teal"/>}
                  <span style={{marginLeft:"auto",fontFamily:FB,fontSize:11,color:B.grey4,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {row.fields[1]?.trim()}
                  </span>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {row.issues.slice(0,3).map((iss,i) => {
                    const isRed = iss.severity==="red";
                    return (
                      <span key={i} style={{
                        fontSize:10,fontFamily:FH,fontWeight:800,
                        background:isRed?B.redLt:B.orangeLt,
                        color:isRed?B.redDk:B.orange,
                        padding:"1px 8px",border:`1px solid ${isRed?B.red:B.orange}`,
                        textTransform:"uppercase",letterSpacing:"0.04em",
                      }}>
                        {iss.field}
                      </span>
                    );
                  })}
                  {row.issues.length > 3 && <span style={{fontSize:10,color:B.grey4,alignSelf:"center",fontFamily:FH,fontWeight:800}}>+{row.issues.length-3}</span>}
                </div>
              </div>
            ))}

            {/* All clean */}
            {!selRow && rows.length > 0 && allClean && (
              <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"20px 12px",gap:14,textAlign:"center"}}>
                <div style={{width:72,height:72,background:B.green,border:`3px solid ${B.greenDk}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:34,boxShadow:SHADOW}}>✓</div>
                <div style={{fontFamily:FH,fontSize:20,fontWeight:900,textTransform:"uppercase",color:B.greenDk}}>ALL CLEAN</div>
                <div style={{fontFamily:FB,fontSize:12,color:B.grey4}}>Every row passed all 16 validation checks.</div>
                <TurtleBar msg="Every row checks out. Your employees' contributions are protected. Download and submit!"/>
                <div style={{display:"flex",gap:8,width:"100%",flexWrap:"wrap"}}>
                  <BBtn onClick={download} variant="green" size="lg" style={{flex:1,justifyContent:"center"}}>↓ DOWNLOAD</BBtn>
                  <BBtn onClick={()=>exportPDF(rows,fileName)} variant="ghost" size="lg" style={{flex:1,justifyContent:"center"}}>PDF REPORT</BBtn>
                </div>
                <BBtn onClick={()=>exportCSV(rows,fileName)} variant="ghost" size="md" style={{width:"100%",justifyContent:"center"}}>EXPORT CSV</BBtn>
              </div>
            )}
          </div>

          {/* Footer stats */}
          <div style={{borderTop:`2px solid ${B.ink}`,padding:"10px 14px",flexShrink:0,display:"grid",gridTemplateColumns:"repeat(4,1fr)",background:B.grey1,backgroundImage:HALFTONE}}>
            {[
              {val:totalRed,    label:"ERRORS", color:B.red},
              {val:totalOrange, label:"FLAGS",  color:B.orange},
              {val:cleanCount,  label:"CLEAN",  color:B.green},
              {val:rows.length, label:"TOTAL",  color:B.ink},
            ].map(s => (
              <div key={s.label} style={{textAlign:"center"}}>
                <div style={{fontFamily:FH,fontSize:20,fontWeight:900,color:s.color,lineHeight:1.2}}>{s.val}</div>
                <div style={{fontFamily:FH,fontSize:8,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.08em",color:B.grey4,marginTop:1}}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Disclaimer strip */}
          <div style={{borderTop:`1.5px solid ${B.grey2}`,padding:"5px 12px",flexShrink:0,background:B.grey1}}>
            <div style={{fontFamily:FB,fontSize:9,color:B.grey4,textAlign:"center"}}>
              Unofficial tool · Not affiliated with EPFO · Results indicative only —{" "}
              <button onClick={()=>setShowDisc(true)} style={{background:"none",border:"none",color:B.green,cursor:"pointer",fontSize:9,padding:0,fontFamily:FH,fontWeight:800,textDecoration:"underline"}}>
                DISCLAIMER
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
