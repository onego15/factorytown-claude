(() => {
const g = window.game; g.startPlaying(false); const w = g.world; const D = __gv.dev; const hc = D.hallCenter(w);
w.coins = 5000;
const hall = w.entities.get(w.hallId); hall.inv.plank = 100; hall.inv.log = 100; hall.inv.stone = 50;
const out = {};
const l1 = D.build(w,'lumber',hc,{minEff:0.9}); out.l1 = l1 && [l1.x,l1.y]; out.r1 = l1 && D.route(w,l1.id,w.hallId);
const l2 = D.build(w,'lumber',hc,{minEff:0.9}); out.l2 = l2 && [l2.x,l2.y];
const saw = D.build(w,'sawmill',hc); out.saw = saw && [saw.x,saw.y]; out.r2 = D.route(w,l2.id,saw.id); out.r3 = D.route(w,saw.id,w.hallId);
w.research.add('food');
const farm = D.build(w,'farm',hc); const mill = D.build(w,'mill',hc); out.f=[farm.x,farm.y]; out.m=[mill.x,mill.y];
out.r4 = D.route(w,farm.id,mill.id); const bak = D.build(w,'bakery',hc); out.b=[bak.x,bak.y]; out.r5=D.route(w,mill.id,bak.id); out.r6=D.route(w,bak.id,w.hallId);
for (let i=0;i<900;i++) w.tick();
out.hall = hall.inv;
g.scene.rig.distGoal = 20; g.scene.rig.goal.set(hc.x - 24 + 0.5, 0.5, hc.y - 24 + 0.5);
return out;
})()
