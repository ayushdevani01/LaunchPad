const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
process.env.GITHUB_CLIENT_ID='unit-client-id';
process.env.GITHUB_CLIENT_SECRET='unit-client-secret';
process.env.GITHUB_CALLBACK_URL='https://api.launch-pad.dev/auth/github/callback';
const routes=require('../dist/src/routes/auth').default;

test('GitHub authorization binds a short-lived secure state cookie and rejects forged callbacks',async()=>{
 const app=express();app.use('/auth',routes);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const start=await fetch(base+'/auth/github',{redirect:'manual'});
  assert.equal(start.status,302);
  const url=new URL(start.headers.get('location'));const state=url.searchParams.get('state');
  assert.match(state,/^[a-f0-9]{64}$/);
  assert.equal(url.searchParams.get('scope'),'user:email');
  const cookie=start.headers.get('set-cookie');assert.match(cookie,/__Host-launchpad_oauth=/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Lax/);
  assert.equal((await fetch(base+'/auth/github/callback?code=fake&state='+state)).status,400);
  assert.equal((await fetch(base+'/auth/github/callback?code=fake&state='+state,{headers:{cookie:'__Host-launchpad_oauth='+'a'.repeat(64)}})).status,400);
 } finally {await new Promise(r=>server.close(r))}
});
