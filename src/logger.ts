// logger 工厂，给用户自定义
import { colorConsole, dailyfile } from 'tracer'

const defaultLogConfig: any = {
  root: 'logs',
  allLogsFileName: 'twitter-mcp',
  level: 'debug',
  dateformat: 'yyyy-mm-dd HH:MM:ss.L',
  format: '{{timestamp}}|#|<{{title}}>|#|{{file}}:{{line}}|#|{{message}}',
  inspectOpt: {
    showHidden: false,
    depth: 3
  }
}

export function LogFactory() {
  Object.assign(defaultLogConfig, {})
  let logger = colorConsole(defaultLogConfig)
  // 指定了存储地址的的要按日分割
  if (defaultLogConfig && defaultLogConfig.root) {
    defaultLogConfig.transport = function (data: any) {
      console.log(data.output)
    }
    logger = dailyfile(defaultLogConfig)
  }
  return logger
}

export const logger = LogFactory()