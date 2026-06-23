/**
 * AthleteOS Coach Survey — Google Sheet collector
 * ------------------------------------------------
 * 1. Create a new Google Sheet.
 * 2. Extensions ▸ Apps Script. Delete the stub, paste THIS file.
 * 3. Click Deploy ▸ New deployment ▸ type "Web app".
 *      - Execute as:  Me
 *      - Who has access:  Anyone
 * 4. Copy the /exec URL it gives you.
 * 5. Paste that URL into ENDPOINT at the top of index.html.
 *
 * Each survey submission appends one row. Headers auto-create on first write
 * and any new field becomes a new column automatically.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var data = JSON.parse(e.postData.contents);

    // ensure header row
    var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    if (sheet.getLastRow() === 0) headers = [];

    Object.keys(data).forEach(function (k) {
      if (headers.indexOf(k) === -1) headers.push(k);
    });
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

    var row = headers.map(function (h) {
      var v = data[h];
      return v == null ? '' : v;
    });
    sheet.appendRow(row);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput('AthleteOS survey collector is live.');
}
