import { Router } from 'express';

/**
 * A stand-in for the IFP application form. DEVELOPMENT ONLY.
 *
 * Nobody on this project has seen the real authenticated page, so this is not
 * a copy of it and must never be mistaken for one. What it is: a form built in
 * the shape Indian government portals are actually built in — ASP.NET
 * WebForms, `ctl00_ContentPlaceHolder1_` control ids, a `__VIEWSTATE` hidden
 * field, labels in the table cell to the left rather than in a `<label for>`,
 * numeric option codes, dates as DD/MM/YYYY, and a CAPTCHA next to the submit
 * button.
 *
 * That shape is the point. It exercises the capture heuristics, the transforms
 * and — most importantly — the refusals, so the whole flow can be walked
 * through end to end before anyone has portal access.
 *
 * Mounted only when NODE_ENV is not production. The route does not exist in a
 * production build, so there is nothing to disable later.
 */
export const devRouter = Router();

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Industries Commissionerate — Capital Subsidy Application (MOCK)</title>
<style>
  body { font-family: Verdana, Arial, sans-serif; font-size: 13px; margin: 0; background: #eef2f5; color: #1a2733; }
  .gov-bar { background: #0b4f6c; color: #fff; padding: 10px 18px; }
  .gov-bar strong { font-size: 15px; }
  .gov-bar span { display: block; font-size: 11px; opacity: .85; }
  .mock-note { background: #fff4d6; border-bottom: 1px solid #e0c97f; padding: 8px 18px; font-size: 12px; }
  .wrap { max-width: 900px; margin: 16px auto; background: #fff; border: 1px solid #c9d4de; }
  h2 { background: #dfe8ef; margin: 0; padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #c9d4de; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 7px 10px; border-bottom: 1px solid #edf1f4; vertical-align: middle; }
  td.lbl { width: 300px; color: #33475b; }
  td.lbl .req { color: #b3261e; }
  input[type=text], input[type=number], select, textarea {
    width: 260px; padding: 4px 6px; border: 1px solid #9fb0bf; font: inherit; background: #fff;
  }
  textarea { width: 420px; height: 48px; }
  .actions { padding: 12px; background: #f6f9fb; }
  .btn { padding: 6px 18px; background: #0b4f6c; color: #fff; border: 1px solid #083c52; cursor: pointer; font: inherit; }
  .captcha-box { display: flex; align-items: center; gap: 10px; }
  .captcha-img { font-family: monospace; font-size: 19px; letter-spacing: 6px; background: #dfe8ef;
    border: 1px solid #9fb0bf; padding: 4px 10px; font-style: italic; text-decoration: line-through; }
  .hint { color: #6b7c8c; font-size: 11px; }
</style>
</head>
<body>

<div class="gov-bar">
  <strong>Industries Commissionerate, Government of Gujarat</strong>
  <span>Scheme for Assistance — Capital Subsidy — Application Form</span>
</div>

<div class="mock-note">
  <strong>MOCK PAGE — development only.</strong>
  This is not the IFP portal and is not a copy of it. It imitates the SHAPE of a
  government form so the extension can be exercised before anyone has portal access.
  Nothing entered here is stored or submitted anywhere.
</div>

<form id="aspnetForm" method="post" action="#" onsubmit="return false;">
  <input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="/wEPDwUKMTU0NDk4MzkxNGRk" />
  <input type="hidden" name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="/wEWAwLp3sDLBQK1" />

  <div class="wrap">
    <h2>1. Applicant details</h2>
    <table>
      <tr>
        <td class="lbl">Name of the Applicant Unit <span class="req">*</span></td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtUnitName" name="ctl00$ContentPlaceHolder1$txtUnitName" maxlength="200" /></td>
      </tr>
      <tr>
        <td class="lbl">Trade / Brand Name</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtTradeName" name="ctl00$ContentPlaceHolder1$txtTradeName" maxlength="200" /></td>
      </tr>
      <tr>
        <td class="lbl">Constitution of the Unit <span class="req">*</span></td>
        <td>
          <select id="ctl00_ContentPlaceHolder1_ddlConstitution" name="ctl00$ContentPlaceHolder1$ddlConstitution">
            <option value="0">-- Select --</option>
            <option value="1">Proprietorship</option>
            <option value="2">Partnership Firm</option>
            <option value="3">Private Limited Company</option>
            <option value="4">Public Limited Company</option>
            <option value="5">Limited Liability Partnership</option>
          </select>
          <div class="hint">Portal codes are numeric — needs an option map.</div>
        </td>
      </tr>
      <tr>
        <td class="lbl">PAN of the Unit <span class="req">*</span></td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtPAN" name="ctl00$ContentPlaceHolder1$txtPAN" maxlength="10" style="text-transform:uppercase" /></td>
      </tr>
      <tr>
        <td class="lbl">GSTIN</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtGSTIN" name="ctl00$ContentPlaceHolder1$txtGSTIN" maxlength="15" /></td>
      </tr>
      <tr>
        <td class="lbl">Date of Incorporation (DD/MM/YYYY)</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtIncorpDate" name="ctl00$ContentPlaceHolder1$txtIncorpDate" maxlength="10" /></td>
      </tr>
      <tr>
        <td class="lbl">Contact Person</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtContactPerson" name="ctl00$ContentPlaceHolder1$txtContactPerson" maxlength="120" /></td>
      </tr>
      <tr>
        <td class="lbl">Mobile Number</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtMobile" name="ctl00$ContentPlaceHolder1$txtMobile" maxlength="10" /></td>
      </tr>
      <tr>
        <td class="lbl">E-mail ID</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtEmail" name="ctl00$ContentPlaceHolder1$txtEmail" maxlength="254" /></td>
      </tr>
    </table>
  </div>

  <div class="wrap">
    <h2>2. Project details</h2>
    <table>
      <tr>
        <td class="lbl">Project / Plant Address</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtProjAddr1" name="ctl00$ContentPlaceHolder1$txtProjAddr1" maxlength="200" /></td>
      </tr>
      <tr>
        <td class="lbl">Village / Town</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtVillage" name="ctl00$ContentPlaceHolder1$txtVillage" maxlength="120" /></td>
      </tr>
      <tr>
        <td class="lbl">District <span class="req">*</span></td>
        <td>
          <select id="ctl00_ContentPlaceHolder1_ddlDistrict" name="ctl00$ContentPlaceHolder1$ddlDistrict">
            <option value="0">-- Select District --</option>
            <option value="24">Ahmedabad</option>
            <option value="07">Surat</option>
            <option value="19">Rajkot</option>
            <option value="22">Vadodara</option>
            <option value="11">Bhavnagar</option>
          </select>
        </td>
      </tr>
      <tr>
        <td class="lbl">PIN Code</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtPincode" name="ctl00$ContentPlaceHolder1$txtPincode" maxlength="6" /></td>
      </tr>
      <tr>
        <td class="lbl">GIDC Estate (if applicable)</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtGIDC" name="ctl00$ContentPlaceHolder1$txtGIDC" maxlength="120" /></td>
      </tr>
      <tr>
        <td class="lbl">Plot / Survey Number</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtPlotNo" name="ctl00$ContentPlaceHolder1$txtPlotNo" maxlength="60" /></td>
      </tr>
      <tr>
        <td class="lbl">Date of Commercial Production (DD/MM/YYYY)</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtDOCP" name="ctl00$ContentPlaceHolder1$txtDOCP" maxlength="10" /></td>
      </tr>
    </table>
  </div>

  <div class="wrap">
    <h2>3. Term loan details</h2>
    <table>
      <tr>
        <td class="lbl">Name of Financing Bank <span class="req">*</span></td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtBankName" name="ctl00$ContentPlaceHolder1$txtBankName" maxlength="160" /></td>
      </tr>
      <tr>
        <td class="lbl">Branch</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtBranch" name="ctl00$ContentPlaceHolder1$txtBranch" maxlength="160" /></td>
      </tr>
      <tr>
        <td class="lbl">Loan Account Number</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtLoanAcc" name="ctl00$ContentPlaceHolder1$txtLoanAcc" maxlength="30" /></td>
      </tr>
      <tr>
        <td class="lbl">Sanction Letter Reference</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtSanctionRef" name="ctl00$ContentPlaceHolder1$txtSanctionRef" maxlength="80" /></td>
      </tr>
      <tr>
        <td class="lbl">Date of Sanction (DD/MM/YYYY)</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtSanctionDate" name="ctl00$ContentPlaceHolder1$txtSanctionDate" maxlength="10" /></td>
      </tr>
      <tr>
        <td class="lbl">Date of First Disbursement (DD/MM/YYYY)</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtFirstDisb" name="ctl00$ContentPlaceHolder1$txtFirstDisb" maxlength="10" /></td>
      </tr>
      <tr>
        <td class="lbl">Sanctioned Amount (Rs.)</td>
        <td>
          <input type="text" id="ctl00_ContentPlaceHolder1_txtSanctionAmt" name="ctl00$ContentPlaceHolder1$txtSanctionAmt" maxlength="14" />
          <div class="hint">Whole rupees only — needs the amountWhole transform.</div>
        </td>
      </tr>
      <tr>
        <td class="lbl">Amount Disbursed (Rs.)</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtDisbAmt" name="ctl00$ContentPlaceHolder1$txtDisbAmt" maxlength="14" /></td>
      </tr>
      <tr>
        <td class="lbl">Rate of Interest (%)</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtROI" name="ctl00$ContentPlaceHolder1$txtROI" maxlength="6" /></td>
      </tr>
    </table>
  </div>

  <div class="wrap">
    <h2>4. Employment</h2>
    <table>
      <tr>
        <td class="lbl">Total Employees</td>
        <td><input type="number" id="ctl00_ContentPlaceHolder1_txtTotalEmp" name="ctl00$ContentPlaceHolder1$txtTotalEmp" /></td>
      </tr>
      <tr>
        <td class="lbl">Employees registered under EPF</td>
        <td><input type="number" id="ctl00_ContentPlaceHolder1_txtEPFEmp" name="ctl00$ContentPlaceHolder1$txtEPFEmp" /></td>
      </tr>
      <tr>
        <td class="lbl">Local (Gujarat domicile) Employees</td>
        <td><input type="number" id="ctl00_ContentPlaceHolder1_txtLocalEmp" name="ctl00$ContentPlaceHolder1$txtLocalEmp" /></td>
      </tr>
      <tr>
        <td class="lbl">EPF Establishment Code</td>
        <td><input type="text" id="ctl00_ContentPlaceHolder1_txtEPFCode" name="ctl00$ContentPlaceHolder1$txtEPFCode" maxlength="40" /></td>
      </tr>
      <tr>
        <td class="lbl">Remarks</td>
        <td><textarea id="ctl00_ContentPlaceHolder1_txtRemarks" name="ctl00$ContentPlaceHolder1$txtRemarks"></textarea></td>
      </tr>
    </table>
  </div>

  <!-- Everything below exists so the refusals can be seen working. -->
  <div class="wrap">
    <h2>5. Declaration &amp; submission</h2>
    <table>
      <tr>
        <td class="lbl">Upload signed declaration (PDF)</td>
        <td><input type="file" id="ctl00_ContentPlaceHolder1_fuDeclaration" name="ctl00$ContentPlaceHolder1$fuDeclaration" /></td>
      </tr>
      <tr>
        <td class="lbl">Re-enter portal password to sign</td>
        <td><input type="password" id="ctl00_ContentPlaceHolder1_txtSignPwd" name="ctl00$ContentPlaceHolder1$txtSignPwd" /></td>
      </tr>
      <tr>
        <td class="lbl">Enter the characters shown</td>
        <td>
          <div class="captcha-box">
            <span class="captcha-img">7KQ4Z2</span>
            <input type="text" id="ctl00_ContentPlaceHolder1_txtCaptcha" name="ctl00$ContentPlaceHolder1$txtCaptcha" maxlength="6" />
          </div>
        </td>
      </tr>
      <tr>
        <td class="lbl">I declare the above is true</td>
        <td><input type="checkbox" id="ctl00_ContentPlaceHolder1_chkDeclare" name="ctl00$ContentPlaceHolder1$chkDeclare" /></td>
      </tr>
    </table>
    <div class="actions">
      <input type="submit" id="ctl00_ContentPlaceHolder1_btnSubmit" name="ctl00$ContentPlaceHolder1$btnSubmit" class="btn" value="Submit Application" />
      <button type="button" id="ctl00_ContentPlaceHolder1_btnSaveDraft" class="btn">Save as Draft</button>
    </div>
  </div>
</form>

</body>
</html>`;

devRouter.get('/mock-ifp-form', (_req, res) => {
  res.type('html').send(PAGE);
});
