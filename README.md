# 星鱼谷经营实验室

一个非官方、自托管的星鱼谷经营助手，包含种养调度、市场预测、加工和体力取舍、半小时收支图、版本检查和主机守护。成交和产出仍由游戏服务端结算。

**兼容性：** 这是「长夜归港与暖潮公库」时期的源码快照。尚未适配 2026-11-11「摸鱼小窗、五子棋三档与管家升级」版的收入递减规则。检测到新版时会暂停写入；请勿用这个版本在新版游戏上执行交易。

## 测试

需要 Node.js 22+；可选的主机守护测试需要 Python 3。

```sh
npm ci
npm test
python3 -B -m unittest discover -s ops -p test_watchdog.py
```

这些测试不需要游戏账号，也不会访问游戏站点。完整的经营与调度测试需要在本地安装已验证的旧版规则文件：

```sh
npm run rules:install -- /path/to/reviewed/pet-world-rules.js
npm run test:rules
```

仓库不分发站方规则源码。安装脚本只接受与固定指纹相符的文件；如果你没有这版文件，可运行上面的基础测试并阅读实现。扫描器将在线模块作为文本解析，不会下载后自动执行。

## 本机部署

1. 先按上面的步骤安装匹配的本地规则文件。
2. 把 `.env.example` 复制为 `runtime.env`。填写自己的游戏账号数字 ID 和至少 24 字符的随机 `DASHBOARD_TOKEN`；可用 `openssl rand -hex 32` 生成后者。
3. 在 `data/session.cookie` 私下保存自己账号的会话，仅让运行用户可读。直接运行时数据目录归当前用户；使用 Compose 时，容器以 UID 1000 运行，需给它读写该目录的权限。
4. 运行 `npm start` 或 `docker compose up -d --build`，打开 <http://127.0.0.1:3020/lab/isle-economy/>，以 `owner` 和设置的看板密码登录。默认只在本机提供入口，远程访问建议使用 SSH 隧道。服务初次启动只观察，手动启用才会执行；版本不匹配时不可启用。

Linux 主机可选安装 `ops/` 下的 systemd 定时器：将 `watchdog.py` 放在服务单元的 `ExecStart` 所指路径，安装两个单元到 `/etc/systemd/system/`，再运行 `systemctl daemon-reload` 和 `systemctl enable --now isle-economy-watchdog.timer`。默认检查本机 3020 端口和 `isle-economy` 容器。守护不访问游戏，也不会解除手动暂停。

更多细节见 [版本测绘](SURVEY.md)。本仓库自己的代码和文档使用 [MIT-0](LICENSE)；不包含账号会话、运行数据或站方源码。
