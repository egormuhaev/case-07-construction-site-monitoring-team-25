import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';

@Injectable()
export class StorageService {
  readonly root = resolve(process.env.DATA_DIR ?? '/data');

  relative(absPath: string) {
    return relative(this.root, absPath);
  }

  resolveUnderRoot(...parts: string[]) {
    const candidate = resolve(this.root, ...parts);
    const rel = relative(this.root, candidate);
    if (!rel || rel.startsWith('..')) {
      throw new Error('path is outside DATA_DIR');
    }
    return candidate;
  }

  projectDir(projectId: string) {
    return this.resolveUnderRoot('projects', projectId);
  }

  planPath(projectId: string, planId: string, ext = '.mpp') {
    return this.resolveUnderRoot('projects', projectId, 'plans', `${planId}${ext}`);
  }

  imagePath(projectId: string, day: string, imageId: string, ext = '.jpg') {
    return this.resolveUnderRoot('projects', projectId, 'days', day, `${imageId}${ext}`);
  }

  async writeFile(absPath: string, data: Buffer) {
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, data);
    return this.relative(absPath);
  }

  toPosix(path: string) {
    return path.split('\\').join('/');
  }
}
