'use strict'

const http2 = require('http2')
const fs = require('fs')
const path = require('path')
const cookie = require('cookie');
const helper = require('./src/helper')

const { HTTP2_HEADER_PATH } = http2.constants
const PORT = process.env.PORT || 4000
const PUBLIC_PATH = path.join(__dirname, './public')

const publicFiles = helper.getFiles(PUBLIC_PATH)




// Push file
function push (stream, path) {
  const file = publicFiles.get(path)

  if (!file) {
    return
  }

  stream.pushStream({ [HTTP2_HEADER_PATH]: path }, (err, pushStream, headers) => {
    pushStream.respondWithFD(file.fileDescriptor, file.headers)
  })
}

const clients = {}; // <- map of registered users

const broadCast = (user, msg) => {
  console.log('broadCast', user, msg)
  Object.entries(clients).forEach(([clientId, res]) => res.write(`event: info\ndata: {"sender":"${user}","msg": "${msg}"}\n\n`, 'utf8'));
}

const broadCastAdd = (user) => {
  console.log('add', user)
  Object.entries(clients).forEach(([clientId, res]) => res.write(`event: oper\ndata: {"oper":"add","user":"${user}"}\n\n`, 'utf8'));
}

const broadCastDel = (user) => {
  console.log('del', user)
  Object.entries(clients).forEach(([clientId, res]) => res.write(`event: oper\ndata: {"oper":"del", "user":"${user}"}\n\n`, 'utf8'));
}

// Request handler
const onRequest = (req, res) => {
  // console.log('httpVersion', req.httpVersion)
  
  const reqPath = req.headers[':path'] === '/' ? '/index.html' : req.headers[':path'];
  const file = publicFiles.get(reqPath);

  if (req.headers[':method'] === 'GET' && reqPath === '/users') {
    res.stream.respond({ 'content-type': 'text/html', ':status': 200 });
    res.stream.end(JSON.stringify({ userList: Object.keys(clients) }));
    return;
  }

  if (req.headers[':method'] === 'POST' && reqPath === '/message') {
    const cookies = cookie.parse(req.headers.cookie)
    if (!cookies.user) {
      console.log('user unknown')
      res.stream.respond({ 'content-type': 'text/html', ':status': 401 });
      res.stream.end();
      return;
    }
    
    let jsonString = '';
    req.on('data', (data) => {
        jsonString += data;
    });
    req.on('end', () => {
      const json = JSON.parse(jsonString);
      broadCast(cookies.user, json.msg);
    });
    res.stream.respond({ 'content-type': 'text/html', ':status': 204 });
    res.stream.end();
    return;
  }

  if (reqPath === '/register') {
    const cookies = cookie.parse(req.headers.cookie)
    console.log('cookies', cookies.user)
    // req.setTimeout(Infinity);
    // req.socket.setTimeout(Number.MAX_VALUE);
    req.socket.setTimeout(2147483647); // MAX Integer
    res.writeHead(200, {
      'Content-type': 'text/event-stream',
      'access-control-allow-origin': '*',
      'Cache-Control': 'no-cache',
    });

    clients[cookies.user] = res;  // <- Add this client to the broadcast list
    broadCastAdd(cookies.user);
    
    ((clientId) => {
      req.on("close", () => { // <- Remove this client when he disconnects
        delete clients[clientId]
        broadCastDel(clientId);
      });  
    })(cookies.user);      
    return;
  }
  
  // File not found
  if (!file) {
    res.stream.respond({ 'content-type': 'text/html', ':status': 404 });
    res.stream.end('<h1>Page Not Found</h1>');
    return
  }

  // Push with index.html
  if (reqPath === '/index.html') {
    push(res.stream, '/simple.css')
    push(res.stream, '/script.js')
  }

  // Serve file
  res.stream.respondWithFD(file.fileDescriptor, file.headers)
  
  req.on('finish', () => console.log('con closed'))
}

const server = http2.createSecureServer({
  cert: fs.readFileSync(path.join(__dirname, './ssl/cert3.pem')),
  key: fs.readFileSync(path.join(__dirname, './ssl/key3.pem'))
}, onRequest);

server.listen(PORT, "0.0.0.0", (err) => {
  if (err) {
    console.error(err)
    return
  }

  console.log(`Server listening on ${PORT}`)
})
