const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');


// 所有平台和二进制分发包的查找表
const BINARY_DISTRIBUTION_PACKAGES = {
  'darwin-x64': 'bun_darwin_x64',
  'darwin-arm64': 'bun_darwin_arm64',
  'win32-x64': 'bun_windows_x64',
}

// 调整你想要安装的版本。也可以将其设置为动态的。
const BINARY_DISTRIBUTION_VERSION = '1.0.0';

// Windows平台的二进制文件以.exe结尾，因此需要特殊处理。
const binaryName = process.platform === 'win32' ? 'f_cli.exe' : 'f_cli';

// 确定当前平台的包名
const platformSpecificPackageName = BINARY_DISTRIBUTION_PACKAGES[`${process.platform}-${process.arch}`];

// 计算我们要生成的备用二进制文件的路径
const fallbackBinaryPath = path.join(__dirname, binaryName);

// 创建HTTP请求的Promise函数
function makeRequest(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
      } else if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        // 跟随重定向
        makeRequest(response.headers.location).then(resolve, reject);
      } else {
        reject(
          new Error(
            `npm在下载包时返回状态码 ${response.statusCode}！`
          )
        );
      }
    })
      .on('error', (error) => {
        reject(error);
      });
  });
}

// 从tarball中提取文件的函数
function extractFileFromTarball(tarballBuffer, filepath) {
  let offset = 0
  while (offset < tarballBuffer.length) {
    const header = tarballBuffer.subarray(offset, offset + 512)
    offset += 512

    const fileName = header.toString('utf-8', 0, 100).replace(/\0.*/g, '')
    const fileSize = parseInt(header.toString('utf-8', 124, 136).replace(/\0.*/g, ''), 8)

    if (fileName === filepath) {
      return tarballBuffer.subarray(offset, offset + fileSize)
    }

    // 将offset固定到512的上限倍数
    offset = (offset + fileSize + 511) & ~511
  }
}

// 从Npm下载二进制文件的异步函数
async function downloadBinaryFromNpm() {
  // 下载正确二进制分发包的tarball
  const tarballDownloadBuffer = await makeRequest(
    `https://registry.npmjs.org/${platformSpecificPackageName}/-/${platformSpecificPackageName}-${BINARY_DISTRIBUTION_VERSION}.tgz`
  )

  const tarballBuffer = zlib.unzipSync(tarballDownloadBuffer)

  // 从软件包中提取二进制文件并写入磁盘
  fs.writeFileSync(
    fallbackBinaryPath,
    extractFileFromTarball(tarballBuffer, `package/bin/${binaryName}`),
    { mode: 0o755 } // 使二进制文件可执行
  )
}

// 检查是否已安装平台特定的软件包
function isPlatformSpecificPackageInstalled() {
  try {
    // 如果optionalDependency未安装，解析将失败
    require.resolve(`${platformSpecificPackageName}/bin/${binaryName}`)
    return true
  } catch (e) {
    return false
  }
}

// 如果不支持当前平台，抛出错误
if (!platformSpecificPackageName) {
  throw new Error('不支持的平台！')
}

// 如果通过optionalDependencies已安装二进制文件，则跳过下载
if (!isPlatformSpecificPackageInstalled()) {
  console.log('未找到平台特定的软件包。将手动下载二进制文件。')
  downloadBinaryFromNpm()
} else {
  console.log(
    '平台特定的软件包已安装。将回退到手动下载二进制文件。'
  )
}