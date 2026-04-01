"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = void 0;
const functions = __importStar(require("firebase-functions"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const google_auth_library_1 = require("google-auth-library");
const googleapis_1 = require("googleapis");
const dotenv = __importStar(require("dotenv"));
// Load .env file from the functions directory
dotenv.config();
const app = (0, express_1.default)();
// Enable CORS for frontend requests
app.use((0, cors_1.default)({ origin: true, credentials: true }));
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
const oauth2Client = new google_auth_library_1.OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, `${process.env.APP_URL}/auth/google/callback`);
// --- Auth Routes ---
app.get('/api/auth/google/url', (req, res) => {
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/spreadsheets'],
        prompt: 'consent'
    });
    res.json({ url });
});
app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    try {
        const { tokens } = await oauth2Client.getToken(code);
        res.cookie('google_tokens', JSON.stringify(tokens), {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
        });
        res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
    }
    catch (error) {
        console.error('Error getting tokens:', error);
        res.status(500).send('Authentication failed');
    }
});
// --- Sheets API Routes ---
app.get('/api/sheets/data', async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const tokensStr = req.cookies.google_tokens;
    if (!tokensStr) {
        res.status(401).json({ error: 'Not authenticated with Google' });
        return;
    }
    const tokens = JSON.parse(tokensStr);
    oauth2Client.setCredentials(tokens);
    const sheets = googleapis_1.google.sheets({ version: 'v4', auth: oauth2Client });
    const spreadsheetId = '1TG4J8xqtDRhvAlbmkMrojiFT_-lEHqL4quxuH_kIYq4';
    try {
        const targetGid = 422301218;
        const meta = await sheets.spreadsheets.get({ spreadsheetId });
        const sheet = ((_a = meta.data.sheets) === null || _a === void 0 ? void 0 : _a.find(s => { var _a; return ((_a = s.properties) === null || _a === void 0 ? void 0 : _a.sheetId) === targetGid; })) || ((_b = meta.data.sheets) === null || _b === void 0 ? void 0 : _b[0]);
        const sheetName = ((_c = sheet === null || sheet === void 0 ? void 0 : sheet.properties) === null || _c === void 0 ? void 0 : _c.title) || 'Sheet1';
        const sheetId = ((_d = sheet === null || sheet === void 0 ? void 0 : sheet.properties) === null || _d === void 0 ? void 0 : _d.sheetId) || 0;
        const gridProps = (_e = sheet === null || sheet === void 0 ? void 0 : sheet.properties) === null || _e === void 0 ? void 0 : _e.gridProperties;
        let rowCount = (gridProps === null || gridProps === void 0 ? void 0 : gridProps.rowCount) || 0;
        if (gridProps && (gridProps.rowCount < 24)) {
            console.log(`Expanding sheet ${sheetName} to 40 rows for data fetch`);
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [
                        {
                            updateSheetProperties: {
                                properties: {
                                    sheetId,
                                    gridProperties: { rowCount: 40 }
                                },
                                fields: 'gridProperties(rowCount)'
                            }
                        }
                    ]
                }
            });
            rowCount = 40;
        }
        if (rowCount === 0) {
            res.json({ projects: [], members: [], raw: [] });
            return;
        }
        let targetRange = `'${sheetName}'!A24:U100`;
        if (rowCount < 24) {
            targetRange = `'${sheetName}'!A1:U${rowCount}`;
        }
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: targetRange,
        });
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            res.json({ projects: [], members: [], raw: [] });
            return;
        }
        const membersMap = new Map();
        const projectsMap = new Map();
        rows.forEach(row => {
            const memberName = row[0];
            const projectName = row[1];
            if (memberName && memberName !== 'Member' && memberName.trim() !== '') {
                membersMap.set(memberName, { name: memberName, level: row[2] || '' });
            }
            if (projectName && projectName !== 'Project' && projectName.trim() !== '') {
                projectsMap.set(projectName, { name: projectName });
            }
        });
        res.json({
            members: Array.from(membersMap.values()),
            projects: Array.from(projectsMap.values()),
            raw: rows,
            count: projectsMap.size
        });
    }
    catch (error) {
        console.error('Error fetching sheet data:', ((_f = error.response) === null || _f === void 0 ? void 0 : _f.data) || error.message);
        res.status(500).json({
            error: 'Failed to fetch spreadsheet data',
            details: ((_j = (_h = (_g = error.response) === null || _g === void 0 ? void 0 : _g.data) === null || _h === void 0 ? void 0 : _h.error) === null || _j === void 0 ? void 0 : _j.message) || error.message
        });
    }
});
app.post('/api/sheets/update', express_1.default.json(), async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const tokensStr = req.cookies.google_tokens;
    if (!tokensStr) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }
    const { matrix } = req.body;
    const tokens = JSON.parse(tokensStr);
    oauth2Client.setCredentials(tokens);
    const sheets = googleapis_1.google.sheets({ version: 'v4', auth: oauth2Client });
    const spreadsheetId = '1TG4J8xqtDRhvAlbmkMrojiFT_-lEHqL4quxuH_kIYq4';
    try {
        const targetGid = 422301218;
        const meta = await sheets.spreadsheets.get({ spreadsheetId });
        const sheet = ((_a = meta.data.sheets) === null || _a === void 0 ? void 0 : _a.find(s => { var _a; return ((_a = s.properties) === null || _a === void 0 ? void 0 : _a.sheetId) === targetGid; })) || ((_b = meta.data.sheets) === null || _b === void 0 ? void 0 : _b[0]);
        const sheetName = ((_c = sheet === null || sheet === void 0 ? void 0 : sheet.properties) === null || _c === void 0 ? void 0 : _c.title) || 'Sheet1';
        const sheetId = ((_d = sheet === null || sheet === void 0 ? void 0 : sheet.properties) === null || _d === void 0 ? void 0 : _d.sheetId) || 0;
        const gridProps = (_e = sheet === null || sheet === void 0 ? void 0 : sheet.properties) === null || _e === void 0 ? void 0 : _e.gridProperties;
        const targetMaxRow = 24 + matrix.length;
        const targetMaxCol = 21;
        if (gridProps && (gridProps.rowCount < targetMaxRow || gridProps.columnCount < targetMaxCol)) {
            console.log(`Expanding sheet grid to ${targetMaxRow} rows and ${targetMaxCol} columns`);
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [
                        {
                            updateSheetProperties: {
                                properties: {
                                    sheetId,
                                    gridProperties: {
                                        rowCount: Math.max(gridProps.rowCount, targetMaxRow),
                                        columnCount: Math.max(gridProps.columnCount, targetMaxCol)
                                    }
                                },
                                fields: 'gridProperties(rowCount,columnCount)'
                            }
                        }
                    ]
                }
            });
        }
        const targetRange = `'${sheetName}'!N24:U${targetMaxRow}`;
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: targetRange,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: matrix
            }
        });
        res.json({ success: true });
    }
    catch (error) {
        if (error.code === 403 || error.code === 401 || (((_f = error.response) === null || _f === void 0 ? void 0 : _f.status) === 403)) {
            res.clearCookie('google_tokens');
            res.status(401).json({
                error: 'Insufficient permissions or session expired. Please re-authenticate.',
                details: 'Request had insufficient authentication scopes'
            });
            return;
        }
        res.status(500).json({
            error: 'Failed to update Google Sheets',
            details: ((_j = (_h = (_g = error.response) === null || _g === void 0 ? void 0 : _g.data) === null || _h === void 0 ? void 0 : _h.error) === null || _j === void 0 ? void 0 : _j.message) || error.message
        });
    }
});
app.post('/api/sheets/setup', express_1.default.json(), async (req, res) => {
    var _a, _b, _c, _d, _e;
    const tokensStr = req.cookies.google_tokens;
    if (!tokensStr) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }
    const tokens = JSON.parse(tokensStr);
    oauth2Client.setCredentials(tokens);
    const sheets = googleapis_1.google.sheets({ version: 'v4', auth: oauth2Client });
    const spreadsheetId = '1TG4J8xqtDRhvAlbmkMrojiFT_-lEHqL4quxuH_kIYq4';
    try {
        const meta = await sheets.spreadsheets.get({ spreadsheetId });
        const targetGid = 422301218;
        const sheet = ((_a = meta.data.sheets) === null || _a === void 0 ? void 0 : _a.find(s => { var _a; return ((_a = s.properties) === null || _a === void 0 ? void 0 : _a.sheetId) === targetGid; })) || ((_b = meta.data.sheets) === null || _b === void 0 ? void 0 : _b[0]);
        const sheetName = ((_c = sheet === null || sheet === void 0 ? void 0 : sheet.properties) === null || _c === void 0 ? void 0 : _c.title) || 'Sheet1';
        const sheetId = ((_d = sheet === null || sheet === void 0 ? void 0 : sheet.properties) === null || _d === void 0 ? void 0 : _d.sheetId) || 0;
        const gridProps = (_e = sheet === null || sheet === void 0 ? void 0 : sheet.properties) === null || _e === void 0 ? void 0 : _e.gridProperties;
        const requiredRows = 40;
        const requiredCols = 22;
        if (gridProps && (gridProps.rowCount < requiredRows || gridProps.columnCount < requiredCols)) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [
                        {
                            updateSheetProperties: {
                                properties: {
                                    sheetId,
                                    gridProperties: {
                                        rowCount: Math.max(gridProps.rowCount, requiredRows),
                                        columnCount: Math.max(gridProps.columnCount, requiredCols)
                                    }
                                },
                                fields: 'gridProperties(rowCount,columnCount)'
                            }
                        }
                    ]
                }
            });
        }
        const dataRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetName}'!A24:M100`,
        });
        const rows = dataRes.data.values || [];
        const members = rows.map(r => r[0]).filter(Boolean);
        const projects = Array.from(new Set(rows.map(r => r[1]).filter(Boolean)));
        const requests = [];
        const mainHeaders = [['Member', 'Project', 'Task', 'Status', 'Start', 'End', 'Duration', 'Progress', 'Priority', 'Assignee', 'Tags', 'Notes', 'Link']];
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'${sheetName}'!A23:M23`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: mainHeaders }
        });
        const scheduleHeaders = [['Mon AM', 'Mon PM', 'Tue AM', 'Tue PM', 'Wed AM', 'Wed PM', 'Thu AM', 'Thu PM']];
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'${sheetName}'!N23:U23`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: scheduleHeaders }
        });
        requests.push({
            repeatCell: {
                range: { sheetId, startRowIndex: 22, endRowIndex: 23, startColumnIndex: 0, endColumnIndex: 21 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: { red: 0.1, green: 0.1, blue: 0.3 },
                        textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
                        horizontalAlignment: 'CENTER'
                    }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
            }
        });
        const rowCountToFormat = Math.max(members.length, 10);
        if (projects.length > 0) {
            requests.push({
                setDataValidation: {
                    range: {
                        sheetId,
                        startRowIndex: 23,
                        endRowIndex: 23 + rowCountToFormat,
                        startColumnIndex: 13,
                        endColumnIndex: 21
                    },
                    rule: {
                        condition: {
                            type: 'ONE_OF_LIST',
                            values: projects.map(p => ({ userEnteredValue: p }))
                        },
                        showCustomUi: true,
                        strict: false
                    }
                }
            });
            const colors = [
                { red: 0.8, green: 0.9, blue: 1.0 },
                { red: 1.0, green: 0.9, blue: 0.8 },
                { red: 0.8, green: 1.0, blue: 0.8 },
                { red: 1.0, green: 0.8, blue: 0.8 },
                { red: 0.9, green: 0.8, blue: 1.0 },
            ];
            projects.forEach((project, index) => {
                const color = colors[index % colors.length];
                requests.push({
                    addConditionalFormatRule: {
                        rule: {
                            ranges: [{ sheetId, startRowIndex: 23, endRowIndex: 23 + rowCountToFormat, startColumnIndex: 13, endColumnIndex: 21 }],
                            booleanRule: {
                                condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: project }] },
                                format: { backgroundColor: color, textFormat: { bold: true } }
                            }
                        },
                        index: 0
                    }
                });
            });
        }
        requests.push({
            updateBorders: {
                range: { sheetId, startRowIndex: 22, endRowIndex: 23 + rowCountToFormat, startColumnIndex: 0, endColumnIndex: 21 },
                top: { style: 'SOLID', width: 1 },
                bottom: { style: 'SOLID', width: 1 },
                left: { style: 'SOLID', width: 1 },
                right: { style: 'SOLID', width: 1 },
                innerHorizontal: { style: 'SOLID', width: 1 },
                innerVertical: { style: 'SOLID', width: 1 }
            }
        });
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Setup error:', error);
        res.status(500).json({ error: 'Failed to setup visual dashboard' });
    }
});
exports.api = functions.https.onRequest(app);
//# sourceMappingURL=index.js.map