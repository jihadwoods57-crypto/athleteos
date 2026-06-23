import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const wait = (ms=220)=>new Promise(r=>setTimeout(r,ms));
let fails=0;
const assert=(name,cond)=>{ console.log((cond?'PASS':'FAIL')+' — '+name); if(!cond) fails++; };

function make(){
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true});
  const w=dom.window; w.scrollTo=()=>{};
  const stem=()=>w.document.querySelector('h1.q')?.textContent.trim()||'';
  const opts=()=>[...w.document.querySelectorAll('.opt')].map(o=>o.textContent.trim());
  const click=(txt)=>{ const b=[...w.document.querySelectorAll('.opt,.btn,.skip')]
      .find(x=>x.textContent.trim().replace(/\s+/g,' ').includes(txt));
    if(!b) throw new Error('no button "'+txt+'" | have: '+opts().join(' / ')); b.click(); };
  const fwd=()=>w.document.getElementById('fwd');
  const setText=(sel,val)=>{ const el=w.document.querySelector(sel); el.value=val; el.dispatchEvent(new w.Event('input')); };
  return {w,stem,opts,click,fwd,setText};
}

// ---- BRANCH A: College Coach + College athletes (ATHLETE track, single clientele) ----
{
  const {stem,opts,click,fwd}=make();
  click('Start'); await wait();
  assert('Q1 role shown', stem()==='What best describes your role?');
  click('College Coach'); await wait();                 // single -> auto-advance
  assert('Q2 clientele shown', /Who do you primarily develop/.test(stem()));
  click('College athletes');                            // multi select (no auto-advance)
  await wait(40);
  assert('Continue enabled after a pick', !fwd().disabled);
  click('Continue'); await wait();                      // one selection -> q2b skipped
  assert('Q2b skipped (single clientele)', /hardest part to actually control/.test(stem()));
  assert('Q3 piped who="college athletes"', /college athletes/.test(stem()));
  assert('Q3 ATHLETE options', opts().includes('Recovery & sleep'));
  click('Recovery & sleep'); await wait();
  assert('Q4 how-you-know shown', /how do you actually know/.test(stem()));
  click('An app or software'); await wait();
  assert('Q4b conditional shown (software picked)', /Which app or software/.test(stem()));
  console.log('--- athlete branch OK ---\n');
}

// ---- BRANCH B: Nutritionist + 2 clienteles -> q2b, FITNESS track ----
{
  const {stem,opts,click}=make();
  click('Start'); await wait();
  click('Nutritionist'); await wait();
  click('Weight-loss clients');
  click('General fitness clients');
  click('Continue'); await wait();
  assert('Q2b shown when >1 clientele', /core of your business/.test(stem()));
  click('Weight-loss clients'); await wait();           // pick primary -> auto-advance
  assert('Q3 fitness wording', /hardest part to actually control/.test(stem()));
  assert('Q3 FITNESS options (no "Recovery & sleep", has retention)',
         !opts().includes('Recovery & sleep') && opts().includes('Client retention / drop-off'));
  assert('Q3 piped who="weight-loss clients"', /weight-loss clients/.test(stem()));
  click('Client retention / drop-off'); await wait();
  click('They text me'); await wait();                  // not software -> q4b skipped
  assert('Q4b skipped (not software)', /following the plan/.test(stem()));
  console.log('--- fitness branch OK ---\n');
}

// ---- BRANCH C: full no-beta path reaches End, capture skipped ----
{
  const {stem,click,setText}=make();
  click('Start'); await wait();
  click('Personal Trainer'); await wait();
  click('General fitness clients'); click('Continue'); await wait();
  click('Consistency between sessions'); await wait();
  click('Weekly check-ins'); await wait();
  click('Progress stalls'); await wait();
  click('Often'); await wait();
  click('They cancel or don’t renew'); await wait();   // Q7 cost (fitness)
  setText('textarea','Getting people consistent when life gets busy.');
  click('Continue'); await wait();
  click('Very valuable'); await wait();
  click('Game-changing'); await wait();
  click('Very valuable'); await wait();
  click('Yes'); await wait();        // q11b paid-before
  click('No'); await wait();         // q12 -> End, no capture
  assert('No-beta path reaches End (capture skipped)', /That’s it|That's it/.test(stem()));
  console.log('--- no-beta path OK ---\n');
}

// ---- BRANCH D: beta path shows capture, validates email ----
{
  const {w,stem,click,setText,fwd}=make();
  click('Start'); await wait();
  click('Personal Trainer'); await wait();
  click('Youth athletes'); click('Continue'); await wait();   // athlete single
  click('Motivation & buy-in'); await wait();
  click('They text me'); await wait();
  click('Progress stalls'); await wait();
  click('Sometimes'); await wait();
  click('Lost development time'); await wait();                // Q7 cost (athlete)
  click('Skip this one'); await wait();                        // Q8 skip works
  click('Very valuable'); await wait();
  click('Useful'); await wait();
  click('Game-changing'); await wait();
  click('Yes'); await wait();                                  // q11b
  click('Yes'); await wait();                                  // q12 -> capture
  assert('Capture shown for beta yes', /Where should we reach you/.test(stem()));
  assert('Send disabled before name+email', fwd().disabled);
  setText('.field input[type=text]','Coach Dave');
  setText('input[type=email]','dave@team.com');
  await wait(40);
  assert('Send enabled after name+valid email', !fwd().disabled);
  console.log('--- beta capture path OK ---\n');
}

console.log(fails===0 ? 'ALL CHECKS PASSED ✅' : (fails+' CHECK(S) FAILED ❌'));
process.exit(fails===0?0:1);
