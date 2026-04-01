import * as functions from 'firebase-functions';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import * as dotenv from 'dotenv';

// Load .env file from the functions directory
dotenv.config();

const app = express();

// Enable CORS for frontend requests
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/google/callback`
);

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
    const { tokens } = await oauth2Client.getToken(code as string);
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
  } catch (error) {
    console.error('Error getting tokens:', error);
    res.status(500).send('Authentication failed');
  }
});

// --- Sheets API Routes ---

app.get('/api/sheets/data', async (req, res) => {
  const tokensStr = req.cookies.google_tokens;
  if (!tokensStr) {
    res.status(401).json({ error: 'Not authenticated with Google' });
    return;
  }

  const tokens = JSON.parse(tokensStr);
  oauth2Client.setCredentials(tokens);

  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  const spreadsheetId = '1TG4J8xqtDRhvAlbmkMrojiFT_-lEHqL4quxuH_kIYq4';
  
  try {
    const targetGid = 422301218;
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = meta.data.sheets?.find(s => s.properties?.sheetId === targetGid) || meta.data.sheets?.[0];
    
    const sheetName = sheet?.properties?.title || 'Sheet1';
    const sheetId = sheet?.properties?.sheetId || 0;
    const gridProps = sheet?.properties?.gridProperties;

    let rowCount = gridProps?.rowCount || 0;

    if (gridProps && (gridProps.rowCount! < 24)) {
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
  } catch (error: any) {
    console.error('Error fetching sheet data:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to fetch spreadsheet data', 
      details: error.response?.data?.error?.message || error.message 
    });
  }
});

app.post('/api/sheets/update', express.json(), async (req, res) => {
  const tokensStr = req.cookies.google_tokens;
  if (!tokensStr) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { matrix } = req.body;
  const tokens = JSON.parse(tokensStr);
  oauth2Client.setCredentials(tokens);

  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  const spreadsheetId = '1TG4J8xqtDRhvAlbmkMrojiFT_-lEHqL4quxuH_kIYq4';

  try {
    const targetGid = 422301218;
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = meta.data.sheets?.find(s => s.properties?.sheetId === targetGid) || meta.data.sheets?.[0];
    
    const sheetName = sheet?.properties?.title || 'Sheet1';
    const sheetId = sheet?.properties?.sheetId || 0;
    const gridProps = sheet?.properties?.gridProperties;

    const targetMaxRow = 24 + matrix.length;
    const targetMaxCol = 21; 

    if (gridProps && (gridProps.rowCount! < targetMaxRow || gridProps.columnCount! < targetMaxCol)) {
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
                    rowCount: Math.max(gridProps.rowCount!, targetMaxRow),
                    columnCount: Math.max(gridProps.columnCount!, targetMaxCol)
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
  } catch (error: any) {
    if (error.code === 403 || error.code === 401 || (error.response?.status === 403)) {
      res.clearCookie('google_tokens');
      res.status(401).json({ 
        error: 'Insufficient permissions or session expired. Please re-authenticate.',
        details: 'Request had insufficient authentication scopes'
      });
      return;
    }

    res.status(500).json({ 
      error: 'Failed to update Google Sheets', 
      details: error.response?.data?.error?.message || error.message 
    });
  }
});

app.post('/api/sheets/setup', express.json(), async (req, res) => {
  const tokensStr = req.cookies.google_tokens;
  if (!tokensStr) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const tokens = JSON.parse(tokensStr);
  oauth2Client.setCredentials(tokens);

  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  const spreadsheetId = '1TG4J8xqtDRhvAlbmkMrojiFT_-lEHqL4quxuH_kIYq4';

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const targetGid = 422301218;
    const sheet = meta.data.sheets?.find(s => s.properties?.sheetId === targetGid) || meta.data.sheets?.[0];
    const sheetName = sheet?.properties?.title || 'Sheet1';
    const sheetId = sheet?.properties?.sheetId || 0;
    const gridProps = sheet?.properties?.gridProperties;

    const requiredRows = 40;
    const requiredCols = 22; 

    if (gridProps && (gridProps.rowCount! < requiredRows || gridProps.columnCount! < requiredCols)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId,
                  gridProperties: {
                    rowCount: Math.max(gridProps.rowCount!, requiredRows),
                    columnCount: Math.max(gridProps.columnCount!, requiredCols)
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

    const requests: any[] = [];

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
              values: projects.map(p => ({ userEnteredValue: p as string }))
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
                condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: project as string }] },
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
  } catch (error: any) {
    console.error('Setup error:', error);
    res.status(500).json({ error: 'Failed to setup visual dashboard' });
  }
});

export const api = functions.https.onRequest(app);
