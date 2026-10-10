// 집밥 레시피 로컬 서버: 정적 파일 제공 + data.json 읽기/쓰기
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};
const MAX_BODY = 5 * 1024 * 1024;

function seedData() {
  const ing = (name, optional = false) => ({ name, optional });
  return {
    ingredients: [],
    weekPlan: [],
    recipes: [
      {
        id: crypto.randomUUID(),
        name: '김치볶음밥',
        ingredients: [ing('김치'), ing('밥'), ing('대파'), ing('달걀', true), ing('참기름', true)],
        steps: [
          '대파를 송송 썰어 기름에 볶아 파기름을 낸다.',
          '잘게 썬 김치를 넣고 충분히 볶는다.',
          '밥을 넣고 고루 섞어 볶는다.',
          '참기름을 두르고, 달걀프라이를 올려 마무리한다.',
        ],
        source: '기본 예시',
        memo: '',
      },
      {
        id: crypto.randomUUID(),
        name: '된장찌개',
        ingredients: [ing('된장'), ing('두부'), ing('애호박'), ing('양파'), ing('감자', true), ing('대파', true), ing('청양고추', true)],
        steps: [
          '냄비에 물(또는 멸치육수) 500ml를 끓인다.',
          '된장 2큰술을 풀고 감자, 양파를 넣어 끓인다.',
          '애호박과 두부를 넣고 5분 더 끓인다.',
          '대파와 청양고추를 넣고 한소끔 끓여 마무리한다.',
        ],
        source: '기본 예시',
        memo: '',
      },
      {
        id: crypto.randomUUID(),
        name: '계란말이',
        ingredients: [ing('달걀'), ing('소금'), ing('대파', true), ing('당근', true)],
        steps: [
          '달걀 3~4개를 풀고 소금으로 간한다.',
          '잘게 다진 대파와 당근을 섞는다.',
          '약불로 달군 팬에 달걀물을 얇게 붓고 익으면 돌돌 만다.',
          '남은 달걀물을 부어가며 반복해 두껍게 만든다.',
        ],
        source: '기본 예시',
        memo: '',
      },
    ],
  };
}

function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    const data = seedData();
    writeData(data);
    return data;
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!Array.isArray(data.weekPlan)) data.weekPlan = [];
  return data;
}

function writeData(data) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function handleApi(req, res) {
  if (req.method === 'GET') {
    try {
      return send(res, 200, JSON.stringify(readData()));
    } catch (err) {
      return send(res, 500, JSON.stringify({ error: 'data.json을 읽을 수 없습니다: ' + err.message }));
    }
  }
  if (req.method === 'PUT') {
    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) tooLarge = true;
    });
    req.on('end', () => {
      if (tooLarge) return send(res, 413, JSON.stringify({ error: '데이터가 너무 큽니다' }));
      try {
        const data = JSON.parse(body);
        if (!Array.isArray(data.ingredients) || !Array.isArray(data.recipes)) {
          return send(res, 400, JSON.stringify({ error: '잘못된 데이터 형식' }));
        }
        writeData({
          ingredients: data.ingredients,
          recipes: data.recipes,
          weekPlan: Array.isArray(data.weekPlan) ? data.weekPlan : [],
        });
        send(res, 200, JSON.stringify({ ok: true }));
      } catch (err) {
        send(res, 400, JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
  send(res, 405, JSON.stringify({ error: 'Method not allowed' }));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/data') return handleApi(req, res);

  const entry = STATIC_FILES[url.pathname];
  if (!entry || req.method !== 'GET') return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  fs.readFile(path.join(ROOT, entry[0]), (err, content) => {
    if (err) return send(res, 500, 'File error', 'text/plain; charset=utf-8');
    send(res, 200, content, entry[1]);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('🍚 집밥 레시피 실행 중');
  console.log(`   이 컴퓨터:  http://localhost:${PORT}`);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`   같은 Wi-Fi: http://${a.address}:${PORT}`);
    }
  }
  console.log(`   데이터 파일: ${DATA_FILE}`);
});
