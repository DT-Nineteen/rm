function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🚀 PA Dev Manager')
    .addItem('Mở Bảng Điều Khiển (Rộng)', 'showDialog')
    .addToUi();
}

function showDialog() {
  var html = HtmlService.createTemplateFromFile('Sidebar')
    .evaluate()
    .setTitle('PA Dev Manager - Timeline Dashboard')
    .setWidth(1050) // Chiều rộng lớn hơn
    .setHeight(700); // Chiều cao lớn hơn
  SpreadsheetApp.getUi().showModelessDialog(html, 'PA Dev Manager - Timeline Dashboard');
}

/**
 * Lấy dữ liệu từ Sheet để hiển thị lên Sidebar
 */
function getSheetData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // Ưu tiên tab Tháng 4 (gid: 422301218)
  var sheet = ss.getSheets().find(s => s.getSheetId() === 422301218) || ss.getSheets()[0];
  var data = sheet.getRange('A24:U100').getValues();
  
  var members = [];
  var projects = new Set();
  var schedule = [];
  
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (row[0]) { // Tên thành viên ở cột A
      members.push(row[0]);
      if (row[1]) projects.add(row[1]); // Dự án ở cột B
      schedule.push(row.slice(13, 21)); // Dữ liệu lịch từ cột N đến U
    }
  }
  
  return {
    members: members,
    projects: Array.from(projects),
    schedule: schedule,
    sheetName: sheet.getName()
  };
}

/**
 * Cập nhật một ô lịch trình từ Sidebar
 */
function updateCell(memberIndex, dayIndex, value) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets().find(s => s.getSheetId() === 422301218) || ss.getSheets()[0];
  
  // Hàng bắt đầu từ 24, Cột bắt đầu từ N (cột thứ 14)
  var row = 24 + memberIndex;
  var col = 14 + dayIndex;
  
  sheet.getRange(row, col).setValue(value);
  return true;
}
