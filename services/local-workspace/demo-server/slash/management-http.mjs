import {readCardWorkspace,readCardTransactions} from './card-workspace.mjs';
import {bindCardOwner} from './card-ownership.mjs';
import {financeRead,financeWrite} from './crypto-finance.mjs';
import {seedPortal} from './portal.mjs';
import {liveRequestGuard,auditLive} from './live.mjs';
import {seedCardAdmin,cardAdminRead,cardAdminWrite,demoIdentities} from './card-admin.mjs';
import {fxRead} from './fx/query.mjs';
import {channelList,channelDetail,saveChannel,channelCatalog,importChannelProducts} from './channels.mjs';
import {seedBins,binsList,binsDetail,saveBin} from './bins.mjs';
import { consoleRead, consoleWrite } from "./console.mjs";
import {
  managementRead,
  managementWrite,
  seedManagement,
  previewFee,
  completeReset,
  createSession,
  session,
  memberLogin,
} from "./management.mjs";
export function managementHandler(db, ns, {live}={}) {
  const attempts = new Map();
  return async (req, res, url) => {
    const prefix = "/admin-api/settlement-management/demo/management/";
    if (!url.pathname.startsWith(prefix)) return false;
    const path = decodeURIComponent(url.pathname.slice(prefix.length));
    const send = (data, status = 200, cookie) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        ...(cookie ? { "Set-Cookie": cookie } : {}),
      });
      res.end(
        JSON.stringify({
          success: status < 400,
          data,
          ...(status >= 400 ? { message: data.message } : {}),
        }),
      );
    };
    try {
      seedManagement(db, ns);
      const cookies = Object.fromEntries(
        (req.headers.cookie || "").split(";").map((c) => c.trim().split("=")),
      );
      let body = {};
      if (req.method === "POST") {
        if (
          !/^http:\/\/(127\.0\.0\.1|localhost):(8850|8852)$/.test(
            req.headers.origin || "",
          )
        ) {
          send({ message: "仅接受本地Demo来源" }, 403);
          return true;
        }
        let text = "";
        for await (const chunk of req) {
          text += chunk;
          if (text.length > 32000) {
            send({ message: "请求过大" }, 413);
            return true;
          }
        }
        body = JSON.parse(text || "{}");
        if (["session", "reset/complete", "member-login"].includes(path)) {
          const key = `${req.socket.remoteAddress}:${path}`,
            t = Date.now(),
            old = attempts.get(key) || { t, n: 0 };
          const current = t - old.t > 60000 ? { t, n: 0 } : old;
          current.n++;
          attempts.set(key, current);
          if (current.n > 15) {
            send({ message: "请求过于频繁，请稍后重试" }, 429);
            return true;
          }
        }
      }
      if (path === "session" && req.method === "POST") {
        if (
          !Object.hasOwn(demoIdentities,body.username) ||
          body.password !== "demo-only"
        ) {
          send({ message: "本地Demo凭据错误" }, 401);
          return true;
        }
        const identity=demoIdentities[body.username];
        const token = createSession(db, ns, "operator", identity.actor);
        send(
          { actor: identity.actor, mode: "local-demo" },
          200,
          `adsflow_demo_ops=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`,
        );
        return true;
      }
      if (path === "reset/complete" && req.method === "POST") {
        send(completeReset(db, ns, body));
        return true;
      }
      if (path === "member-login" && req.method === "POST") {
        const token = memberLogin(db, ns, body);
        send(
          { authenticated: true },
          200,
          `adsflow_demo_member=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`,
        );
        return true;
      }
      if (path === "member/me" && req.method === "GET") {
        const member = session(db, ns, cookies.adsflow_demo_member, "member");
        send(
          member ? { id: member.subject } : { message: "用户会话无效" },
          member ? 200 : 401,
        );
        return true;
      }
      const operator = session(db, ns, cookies.adsflow_demo_ops, "operator");
      if (!operator) {
        send({ message: "请启用本地管理演示会话" }, 401);
        return true;
      }
      if (path === "session" && req.method === "GET") {
        send({ actor: operator.subject, mode: "local-demo" });
        return true;
      }
      if(/^card-ownership\/cards\/[A-Za-z0-9_-]+$/.test(path)){
        liveRequestGuard(req);
        if(!live){send({message:'真实卡片目录未配置'},503);return true;}
        live.authorize(operator.subject,ns);
        const id=path.split('/')[2],connection=live.config()?.connectionId;
        live.read(`cards/${id}`,{},db); // Only an existing card in the authorized connection can be bound.
        if(req.method==='POST')send(bindCardOwner(db,ns,'slash',connection,id,operator.subject,body));
        else if(req.method==='GET')send(live.read(`cards/${id}`,{},db).row.internal);
        else send({message:'不支持的方法'},405);
        return true;
      }
      if(path==='live'||path.startsWith('live/')){
        liveRequestGuard(req);
        if(!live){send({configured:false},path==='live/status'?200:503);return true;}
        live.authorize(operator.subject,ns);
        const resource=path.slice(5);
        if(resource==='overview'&&url.searchParams.getAll('days').length>1){send({message:'days 不能重复'},400);return true;}
        if(resource==='transactions'&&['from','to'].some(key=>url.searchParams.getAll(key).length>1)){send({message:'时间范围参数不能重复'},400);return true;}
        if(req.method==='GET'){auditLive(db,ns,operator.subject,resource);send(live.read(resource,Object.fromEntries(url.searchParams),db));}
        else if(req.method==='POST'&&resource==='sync'&&Object.keys(body).length===0){
          if(!live.config()?.enabled){send({message:'真实数据同步未启用'},409);return true;}
          auditLive(db,ns,operator.subject,'manual-sync');
          void live.trigger().catch(()=>{});send({accepted:true},202);
        }else send({message:'真实渠道只支持读取和本地同步任务'},405);
        return true;
      }
      if(path.startsWith('card-admin/')){
        seedPortal(db,ns);seedCardAdmin(db,ns);
        const parts=path.slice(11).split('/'),q=Object.fromEntries(url.searchParams);
        if(req.method==='GET'&&parts[0]==='cards'&&parts[1]&&(q.source==='slash'||parts[2]==='transactions')){
          if(q.source==='slash'){liveRequestGuard(req);if(!live)throw Object.assign(new Error('真实渠道未配置'),{status:503});}
          send(parts[2]==='transactions'?readCardTransactions(db,ns,operator.subject,parts[1],q,live):readCardWorkspace(db,ns,operator.subject,parts[1],q,live));
        }
        else if(req.method==='GET')send(cardAdminRead(db,ns,operator.subject,path.slice(11),q));
        else if(req.method==='POST')send(cardAdminWrite(db,ns,operator.subject,path.slice(11),body));
        else send({message:'不支持的请求方法'},405);
        return true;
      }
      if(path.startsWith('finance/')){
        if(req.method==='GET')send(financeRead(db,operator.subject,path.slice(8),Object.fromEntries(url.searchParams)));
        else if(req.method==='POST')send(financeWrite(db,operator.subject,path.slice(8),body));
        else send({message:'不支持的请求方式'},405);
        return true;
      }
      if(req.method==='POST' && operator.subject!=='demo-operator'){send({message:'此隔离身份仅获卡片模块权限，无其他后台写权限'},403);return true;}
      if(path.startsWith('fx/')){if(req.method==='GET')send(fxRead(db,path.slice(3),Object.fromEntries(url.searchParams)));else send({message:'只支持查询'},405);return true;}
      if(path==='channels'||path.startsWith('channels/')){
        const [,id,sub]=path.split('/');
        if(req.method==='GET'&&!sub)send(id?channelDetail(db,ns,id):channelList(db,ns,Object.fromEntries(url.searchParams)));
        else if(req.method==='GET'&&sub==='products')send(channelCatalog(db,ns,id,Object.fromEntries(url.searchParams)));
        else if(req.method==='POST'&&sub==='import')send(importChannelProducts(db,ns,id,body));
        else if(req.method==='POST'&&!sub)send(saveChannel(db,ns,id||null,body));
        else send({message:'接口不存在'},404);
        return true;
      }
      if(path==='bins'||path.startsWith('bins/')) {
        seedBins(db,ns);const id=path==='bins'?null:path.slice(5);
        if(req.method==='GET')send(id?binsDetail(db,ns,id):binsList(db,ns,Object.fromEntries(url.searchParams)));
        else if(req.method==='POST')send(saveBin(db,ns,id,body));
        else send({message:'不支持的请求方式'},405);
        return true;
      }
      if (path.startsWith("console/")) {
        if (req.method === "GET")
          send(
            consoleRead(
              db,
              ns,
              path.slice(8),
              Object.fromEntries(url.searchParams),
            ),
          );
        else if (req.method === "POST")
          send(consoleWrite(db, ns, path.slice(8), body));
        else send({ message: "不支持的请求方式" }, 405);
        return true;
      }
      if (req.method === "GET")
        send(
          managementRead(db, ns, path, Object.fromEntries(url.searchParams)),
        );
      else if (req.method === "POST")
        send(
          path === "fees/preview"
            ? previewFee(db, ns, body)
            : managementWrite(db, ns, path, body),
        );
      else send({ message: "不支持的请求方式" }, 405);
    } catch (e) {
      const duplicate =
        String(e.code || "").includes("SQLITE_CONSTRAINT") ||
        (Number(e.errcode) & 255) === 19;
      send(
        {
          message: duplicate
            ? "名称或邮箱已存在，请核对后重试"
            : e.status || !e.code
              ? e.message
              : "本地数据操作失败",
        },
        duplicate ? 409 : e.status || 400,
      );
    }
    return true;
  };
}
