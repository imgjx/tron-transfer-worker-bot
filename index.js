// index.js
import TronWeb from '@tronweb3/tronweb';

const DEFAULT_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_CONTRACT = env.USDT_CONTRACT || DEFAULT_USDT_CONTRACT;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    if (path === env.ADMIN_IN) {
      return handleAdminPage(request, env);
    }
    
    if (path === `${env.ADMIN_IN}/api/login`) {
      return handleLogin(request, env);
    }
    
    if (path.startsWith(`${env.ADMIN_IN}/api/`)) {
      return handleAPI(request, env);
    }
    
    if (path === '/style.css') {
      return new Response(env.STYLE_CSS, {
        headers: { 'Content-Type': 'text/css' }
      });
    }
    
    if (path === '/js/tronweb.js') {
      return new Response(env.TRONWEB_JS, {
        headers: { 'Content-Type': 'application/javascript' }
      });
    }
    
    return new Response(null, { status: 444 });
  },

  async scheduled(event, env, ctx) {
    await handleAutoTransfer(env);
  }
};

async function handleAutoTransfer(env) {
  try {
    await initDB(env);
    
    const transfers = await env.db.prepare(`
      SELECT * FROM transfers WHERE status = 'ENABLED'
    `).all();
    
    for (const transfer of transfers.results) {
      await processSingleTransfer(transfer, env);
    }
  } catch (error) {
    console.error('Auto transfer error:', error);
  }
}

async function processSingleTransfer(transfer, env) {
  let tronWeb;
  try {
    tronWeb = new TronWeb({
      fullHost: transfer.network,
      privateKey: transfer.private_key
    });
    
    const contractAddress = transfer.usdt_contract || USDT_CONTRACT;
    const contract = await tronWeb.contract().at(contractAddress);
    const balance = await contract.balanceOf(transfer.from_address).call();
    const usdtBalance = parseFloat(tronWeb.fromSun(balance));
    const minAmount = parseFloat(transfer.min_amount);
    
    if (usdtBalance >= minAmount) {
      const trxBalance = await tronWeb.trx.getBalance(transfer.from_address);
      if (trxBalance < tronWeb.toSun(1)) {
        throw new Error('Insufficient TRX for gas fee');
      }
      
      const amountSun = tronWeb.toSun(usdtBalance.toString());
      const tx = await contract.transfer(transfer.to_address, amountSun).send();
      
      await env.db.prepare(`
        INSERT INTO transactions (transfer_id, tx_hash, amount, fee, status)
        VALUES (?, ?, ?, ?, ?)
      `).bind(transfer.id, tx, usdtBalance.toString(), '0', 'COMPLETED').run();
      
      console.log(`Transfer successful: ${transfer.from_address} -> ${transfer.to_address}, Amount: ${usdtBalance} USDT`);
    }
  } catch (error) {
    console.error(`Transfer failed (ID: ${transfer.id}):`, error.message);
    
    await env.db.prepare(`
      INSERT INTO transactions (transfer_id, tx_hash, amount, fee, status, error_message)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(transfer.id, 'FAILED', '0', '0', 'FAILED', error.message).run();
  }
}

async function handleAdminPage(request, env) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TRON-USDT Auto Transfer System | TRON-USDT 自动转账系统</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="container">
    <div class="language-switcher">
      <button onclick="switchLanguage('en')">English</button>
      <button onclick="switchLanguage('zh')">中文</button>
    </div>
    
    <h1 data-en="TRON-USDT Auto Transfer System" data-zh="TRON-USDT 自动转账系统">TRON-USDT Auto Transfer System</h1>
    <p class="subtitle" data-en="Admin Control Panel" data-zh="管理员控制面板">Admin Control Panel</p>
    
    <div id="loginSection" class="card">
      <h3 data-en="Admin Login" data-zh="管理员登录">Admin Login</h3>
      <div class="form-group">
        <label data-en="Username" data-zh="用户名">Username</label>
        <input type="text" id="username" placeholder="Enter admin username" data-en-placeholder="Enter admin username" data-zh-placeholder="输入管理员用户名">
      </div>
      <div class="form-group">
        <label data-en="Password" data-zh="密码">Password</label>
        <input type="password" id="password" placeholder="Enter admin password" data-en-placeholder="Enter admin password" data-zh-placeholder="输入管理员密码">
      </div>
      <button class="btn" onclick="login()" data-en="Login" data-zh="登录">Login</button>
    </div>
    
    <div id="adminPanel" class="card" style="display:none">
      <div id="dashboard" class="stats">
        <div class="stat-card">
          <div class="stat-value" id="totalIn">0 USDT</div>
          <div class="stat-label" data-en="Total In" data-zh="总转入">Total In</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="totalOut">0 USDT</div>
          <div class="stat-label" data-en="Total Out" data-zh="总转出">Total Out</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="netFlow">0 USDT</div>
          <div class="stat-label" data-en="Net Flow" data-zh="净流量">Net Flow</div>
        </div>
      </div>
      
      <h3 data-en="Transfer Configurations" data-zh="转账配置列表">Transfer Configurations</h3>
      <div id="transferList"></div>
      
      <h3 data-en="Create New Transfer" data-zh="新建转发配置">Create New Transfer</h3>
      <div class="form-group">
        <label data-en="Sender Private Key" data-zh="发送私钥">Sender Private Key</label>
        <input type="text" id="privateKey" placeholder="Enter sender private key" data-en-placeholder="Enter sender private key" data-zh-placeholder="输入发送地址私钥">
      </div>
      <div class="form-group">
        <label data-en="Source Network" data-zh="发送网络">Source Network</label>
        <select id="network">
          <option value="https://api.trongrid.io" data-en="TRON Mainnet" data-zh="TRON 主网">TRON Mainnet</option>
          <option value="https://api.shasta.trongrid.io" data-en="Shasta Testnet" data-zh="Shasta 测试网">Shasta Testnet</option>
        </select>
      </div>
      <div class="form-group">
        <label data-en="Destination Address" data-zh="目标地址">Destination Address</label>
        <input type="text" id="toAddress" placeholder="Enter destination TRON address" data-en-placeholder="Enter destination TRON address" data-zh-placeholder="输入目标TRON地址">
      </div>
      <div class="form-group">
        <label data-en="Destination Network" data-zh="目标网络">Destination Network</label>
        <select id="toNetwork">
          <option value="https://api.trongrid.io" data-en="TRON Mainnet" data-zh="TRON 主网">TRON Mainnet</option>
          <option value="https://api.shasta.trongrid.io" data-en="Shasta Testnet" data-zh="Shasta 测试网">Shasta Testnet</option>
        </select>
      </div>
      <div class="form-group">
        <label data-en="Minimum Amount (USDT)" data-zh="最低转账金额 (USDT)">Minimum Amount (USDT)</label>
        <input type="number" id="minAmount" placeholder="e.g., 10.5" step="0.000001" value="1" data-en-placeholder="e.g., 10.5" data-zh-placeholder="例如: 10.5">
      </div>
      <div class="form-group">
        <label data-en="USDT Contract Address (Optional)" data-zh="USDT合约地址 (可选)">USDT Contract Address (Optional)</label>
        <input type="text" id="usdtContract" placeholder="Leave empty for default USDT contract" data-en-placeholder="Leave empty for default USDT contract" data-zh-placeholder="留空使用系统默认USDT合约">
      </div>
      <button class="btn" onclick="createTransfer()" data-en="Create Transfer" data-zh="创建转发">Create Transfer</button>
      
      <div class="github-link">
        //<p data-en="Support us (TRX-USDT): TQaFXHasVCTaf5wwBrCnYi5YrJZos5dS66" data-zh="支持我们(TRX-USDT)：掉">Support us (TRX-USDT): 掉</p>
        <p><a href="https://github.com/imgjx/tron-transfer-worker-bot" target="_blank" data-en="View on GitHub" data-zh="在GitHub上查看">View on GitHub</a></p>
      </div>
    </div>
  </div>
  
  <script src="/js/tronweb.js"></script>
  <script>
    let authToken = '';
    let currentLanguage = 'en';

    function switchLanguage(lang) {
      currentLanguage = lang;
      updateTexts();
    }

    function updateTexts() {
      document.querySelectorAll('[data-en]').forEach(element => {
        const text = element.getAttribute(\`data-\${currentLanguage}\`) || element.getAttribute('data-en');
        if (element.placeholder !== undefined) {
          element.placeholder = text;
        } else {
          element.textContent = text;
        }
      });
      
      document.querySelectorAll('option').forEach(option => {
        const text = option.getAttribute(\`data-\${currentLanguage}\`) || option.getAttribute('data-en');
        if (text) {
          option.textContent = text;
        }
      });
    }

    async function login() {
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      
      const response = await fetch('${env.ADMIN_IN}/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      if (response.ok) {
        const data = await response.json();
        authToken = data.token;
        document.getElementById('loginSection').style.display = 'none';
        document.getElementById('adminPanel').style.display = 'block';
        loadData();
      } else {
        alert(currentLanguage === 'zh' ? '登录失败' : 'Login failed');
      }
    }
    
    async function loadData() {
      await loadDashboard();
      await loadTransfers();
    }
    
    async function loadDashboard() {
      const response = await fetch('${env.ADMIN_IN}/api/dashboard', {
        headers: { 'Authorization': authToken }
      });
      if (response.ok) {
        const data = await response.json();
        document.getElementById('totalIn').textContent = data.totalIn + ' USDT';
        document.getElementById('totalOut').textContent = data.totalOut + ' USDT';
        document.getElementById('netFlow').textContent = data.netFlow + ' USDT';
      }
    }
    
    async function loadTransfers() {
      const response = await fetch('${env.ADMIN_IN}/api/transfers', {
        headers: { 'Authorization': authToken }
      });
      if (response.ok) {
        const transfers = await response.json();
        displayTransfers(transfers);
      }
    }
    
    function displayTransfers(transfers) {
      const list = document.getElementById('transferList');
      if (transfers.length === 0) {
        list.innerHTML = '<p>' + (currentLanguage === 'zh' ? '暂无转发配置' : 'No transfer configurations') + '</p>';
        return;
      }
      
      list.innerHTML = transfers.map(transfer => \`
        <div class="result-item">
          <div class="address">\${currentLanguage === 'zh' ? '发送地址:' : 'From:'} \${transfer.from_address}</div>
          <div class="address">\${currentLanguage === 'zh' ? '目标地址:' : 'To:'} \${transfer.to_address}</div>
          <div>\${currentLanguage === 'zh' ? '网络:' : 'Network:'} \${transfer.network}</div>
          <div>\${currentLanguage === 'zh' ? '最低金额:' : 'Min Amount:'} \${transfer.min_amount} USDT</div>
          <div>\${currentLanguage === 'zh' ? 'USDT合约:' : 'USDT Contract:'} \${transfer.usdt_contract || (currentLanguage === 'zh' ? '系统默认' : 'System Default')}</div>
          <div>\${currentLanguage === 'zh' ? '状态:' : 'Status:'} \${transfer.status}</div>
          <div>
            <button class="copy-btn" onclick="viewTransactions(\${transfer.id})">\${currentLanguage === 'zh' ? '交易记录' : 'Transactions'}</button>
            <button class="copy-btn" onclick="deleteTransfer(\${transfer.id})">\${currentLanguage === 'zh' ? '删除' : 'Delete'}</button>
          </div>
        </div>
      \`).join('');
    }
    
    async function createTransfer() {
      const privateKey = document.getElementById('privateKey').value;
      const network = document.getElementById('network').value;
      const toAddress = document.getElementById('toAddress').value;
      const toNetwork = document.getElementById('toNetwork').value;
      const minAmount = document.getElementById('minAmount').value;
      const usdtContract = document.getElementById('usdtContract').value;
      
      const response = await fetch('${env.ADMIN_IN}/api/transfers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authToken
        },
        body: JSON.stringify({
          private_key: privateKey,
          network: network,
          to_address: toAddress,
          to_network: toNetwork,
          min_amount: minAmount,
          usdt_contract: usdtContract
        })
      });
      
      if (response.ok) {
        alert(currentLanguage === 'zh' ? '创建成功' : 'Created successfully');
        document.getElementById('privateKey').value = '';
        document.getElementById('toAddress').value = '';
        document.getElementById('usdtContract').value = '';
        loadTransfers();
      } else {
        alert(currentLanguage === 'zh' ? '创建失败' : 'Creation failed');
      }
    }
    
    async function deleteTransfer(id) {
      if (!confirm(currentLanguage === 'zh' ? '确定删除此转发配置？' : 'Are you sure to delete this transfer configuration?')) return;
      
      const response = await fetch(\`${env.ADMIN_IN}/api/transfers/\${id}\`, {
        method: 'DELETE',
        headers: { 'Authorization': authToken }
      });
      
      if (response.ok) {
        loadTransfers();
      } else {
        alert(currentLanguage === 'zh' ? '删除失败' : 'Delete failed');
      }
    }
    
    async function viewTransactions(transferId) {
      const response = await fetch(\`${env.ADMIN_IN}/api/transactions/\${transferId}\`, {
        headers: { 'Authorization': authToken }
      });
      
      if (response.ok) {
        const transactions = await response.json();
        alert((currentLanguage === 'zh' ? '交易记录: ' : 'Transactions: ') + JSON.stringify(transactions, null, 2));
      }
    }

    document.addEventListener('DOMContentLoaded', function() {
      updateTexts();
    });
  </script>
</body>
</html>
  `;
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}

async function handleLogin(request, env) {
  const { username, password } = await request.json();
  
  if (username === env.ADMIN_USER && password === env.ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ 
      token: btoa(username + ':' + password),
      message: 'Login successful'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response(JSON.stringify({ error: 'Authentication failed' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleAPI(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !verifyAuth(authHeader, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  
  const url = new URL(request.url);
  const path = url.pathname;
  
  try {
    await initDB(env);
    
    if (path === `${env.ADMIN_IN}/api/dashboard`) {
      return handleDashboard(request, env);
    }
    
    if (path === `${env.ADMIN_IN}/api/transfers`) {
      if (request.method === 'GET') {
        return handleGetTransfers(request, env);
      }
      if (request.method === 'POST') {
        return handleCreateTransfer(request, env);
      }
    }
    
    if (path.startsWith(`${env.ADMIN_IN}/api/transfers/`)) {
      const id = path.split('/').pop();
      if (request.method === 'DELETE') {
        return handleDeleteTransfer(id, env);
      }
    }
    
    if (path.startsWith(`${env.ADMIN_IN}/api/transactions/`)) {
      const transferId = path.split('/').pop();
      return handleGetTransactions(transferId, env);
    }
    
    return new Response(JSON.stringify({ error: 'API not found' }), { status: 404 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

function verifyAuth(authHeader, env) {
  try {
    const token = authHeader.replace('Basic ', '');
    const [username, password] = atob(token).split(':');
    return username === env.ADMIN_USER && password === env.ADMIN_PASSWORD;
  } catch {
    return false;
  }
}

async function initDB(env) {
  try {
    await env.db.prepare(`
      CREATE TABLE IF NOT EXISTS transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        private_key TEXT NOT NULL,
        from_address TEXT NOT NULL,
        to_address TEXT NOT NULL,
        network TEXT NOT NULL,
        to_network TEXT NOT NULL,
        min_amount TEXT NOT NULL,
        usdt_contract TEXT,
        status TEXT DEFAULT 'ENABLED',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    await env.db.prepare(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transfer_id INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        amount TEXT NOT NULL,
        fee TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (transfer_id) REFERENCES transfers (id)
      )
    `).run();
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

async function handleDashboard(request, env) {
  const transactions = await env.db.prepare(`
    SELECT amount, status FROM transactions
  `).all();
  
  let totalIn = 0;
  let totalOut = 0;
  
  transactions.results.forEach(tx => {
    const amount = parseFloat(tx.amount);
    if (tx.status === 'COMPLETED') {
      totalOut += amount;
    } else if (tx.status === 'RECEIVED') {
      totalIn += amount;
    }
  });
  
  return new Response(JSON.stringify({
    totalIn: totalIn.toFixed(6),
    totalOut: totalOut.toFixed(6),
    netFlow: (totalIn - totalOut).toFixed(6)
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleGetTransfers(request, env) {
  const transfers = await env.db.prepare(`
    SELECT * FROM transfers ORDER BY created_at DESC
  `).all();
  
  return new Response(JSON.stringify(transfers.results), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleCreateTransfer(request, env) {
  const { private_key, network, to_address, to_network, min_amount, usdt_contract } = await request.json();
  
  const tronWeb = new TronWeb({ fullHost: network });
  const fromAddress = tronWeb.address.fromPrivateKey(private_key);
  
  const result = await env.db.prepare(`
    INSERT INTO transfers (private_key, from_address, to_address, network, to_network, min_amount, usdt_contract)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(private_key, fromAddress, to_address, network, to_network, min_amount, usdt_contract || null).run();
  
  return new Response(JSON.stringify({ id: result.meta.last_row_id }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleDeleteTransfer(id, env) {
  await env.db.prepare('DELETE FROM transfers WHERE id = ?').bind(id).run();
  return new Response(JSON.stringify({ success: true }));
}

async function handleGetTransactions(transferId, env) {
  const transactions = await env.db.prepare(`
    SELECT * FROM transactions WHERE transfer_id = ? ORDER BY created_at DESC
  `).bind(transferId).all();
  
  return new Response(JSON.stringify(transactions.results), {
    headers: { 'Content-Type': 'application/json' }
  });
}
