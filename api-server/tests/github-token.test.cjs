const {test}=require('node:test');
const assert=require('node:assert/strict');
const axios=require('axios').default;
const {User}=require('../dist/src/models/User');
const {tokenFields,githubAccessToken}=require('../dist/src/lib/github-token');

test('expiring GitHub tokens retain the refresh pair and reject incomplete exchanges',()=>{
  const pair=tokenFields({access_token:'test-access',refresh_token:'test-refresh',expires_in:28800,refresh_token_expires_in:100000},1000);
  assert.equal(pair.githubTokenExpiresAt.getTime(),28801000);
  assert.equal(pair.githubRefreshToken,'test-refresh');
  assert.throws(()=>tokenFields({error:'bad_verification_code'}));
  assert.throws(()=>tokenFields({access_token:'test-access',expires_in:28800}));
});
test('concurrent requests rotate an expired GitHub token pair once',async()=>{
  const oldFind=User.findById,oldUpdate=User.updateOne,oldPost=axios.post;
  let calls=0,updates=0;
  const user={_id:{toString:()=> 'test-user'},githubToken:'test-old',githubRefreshToken:'test-refresh',githubTokenExpiresAt:new Date(0)};
  User.findById=async()=>user;
  User.updateOne=async(filter,update)=>{updates++;assert.equal(filter.githubRefreshToken,'test-refresh');assert.equal(update.$set.githubToken,'test-new');return {modifiedCount:1}};
  axios.post=async(url,body)=>{calls++;assert.equal(body.grant_type,'refresh_token');await new Promise(r=>setTimeout(r,10));return {data:{access_token:'test-new',refresh_token:'test-rotated',expires_in:28800}}};
  try {assert.deepEqual(await Promise.all([githubAccessToken(user),githubAccessToken(user)]),['test-new','test-new']);assert.equal(calls,1);assert.equal(updates,1)}
  finally{User.findById=oldFind;User.updateOne=oldUpdate;axios.post=oldPost}
});
test('valid and legacy GitHub tokens do not trigger a refresh',async()=>{
  assert.equal(await githubAccessToken({_id:{toString:()=> 'valid'},githubToken:'test-valid',githubTokenExpiresAt:new Date(Date.now()+3600000)}),'test-valid');
  assert.equal(await githubAccessToken({_id:{toString:()=> 'legacy'},githubToken:'test-legacy'}),'test-legacy');
  assert.equal(await githubAccessToken(null),'');
});
