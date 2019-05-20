import Serverless from 'serverless';
import Plugin from 'serverless/classes/Plugin';
import Service from 'serverless/classes/Service';
import * as path from 'path';
import { existsSync, writeFile } from 'fs';
import Bundler from 'parcel-bundler';
import getConfig from './src/getConfig';
import { getRestApiBuilder } from '@cotype/core';
import { generateClient } from '@cotype/build-client';

const AUTO_WATCH = Symbol('AUTO_WATCH');
const TS_CONFIG_FILE = Symbol('TS_CONFIG_FILE');

export type Options = {
  db?: string;
  basePath?: string;
  cotypeBasePath?: string;
  buildDir?: string;
  configFile?: string;
  watch?: boolean | symbol;
  [TS_CONFIG_FILE]?: string;
  sessionSecret?: string;
  createMediaBucket: boolean;
  mediaBucketName?: string;
};

type ParcelOptionsWithAutoInstall = Bundler.ParcelOptions & {
  autoInstall: boolean;
};

type ServiceWithPackage = Service & {
  package?: {
    include?: string[];
  };
};

export default class CotypePlugin implements Plugin {
  hooks: {
    [event: string]: Promise<any>;
  };
  serverless: Serverless;
  service: ServiceWithPackage;
  options: Serverless.Options;
  commands: {
    [command: string]: {};
  };
  constructor(serverless: Serverless, options: Serverless.Options) {
    this.serverless = serverless;
    this.service = serverless.service;
    this.options = options;

    this.addFunctions(this.getOptions());

    this.hooks = {
      'before:offline:start': this.offline.bind(this),
      'before:offline:start:init': this.offline.bind(this),
      'before:run:run': this.build.bind(this),
      'before:invoke:local:invoke': this.build.bind(this),
      'before:package:createDeploymentArtifacts': this.build.bind(this),
      'before:deploy:function:packageFunction': this.build.bind(this),
    };
  }

  getOptions() {
    return this.withConfig({
      ...this.getDefaultOptions(),
      ...(this.serverless.service.custom || {})['cotype'],
      ...this.options,
    });
  }

  addIncludes({ buildDir }: Options) {
    this.service.package = this.service.package || {};
    this.service.package.include = this.service.package.include || [];
    this.service.package.include.push(
      path.relative(
        this.serverless.config.servicePath,
        path.resolve(this.serverless.config.servicePath, buildDir!, '**'),
      ),
    );
    this.service.package.include.push(
      'node_modules/@cotype/serverless/lib/src',
    );
  }

  bundlerOpts(options: Options): ParcelOptionsWithAutoInstall {
    return {
      watch: false,
      outDir: path.dirname(options.configFile!),
      outFile: path.basename(options.configFile!),
      autoInstall: false,
      target: 'node',
      logLevel: 2,
      cache: false,
      bundleNodeModules: true,
      sourceMaps: true,
      cacheDir: path.resolve(__dirname, '.cache'),
      hmr: false,
      minify: true,
    };
  }

  async watchConfig(options: Options) {
    if (
      !options[TS_CONFIG_FILE] ||
      !options.watch ||
      options.watch !== AUTO_WATCH
    ) {
      return;
    }

    const bundler = new Bundler(options[TS_CONFIG_FILE], {
      ...this.bundlerOpts(options),
      watch: true,
    });

    bundler.on('bundled', this.buildApi(options));

    await bundler.bundle();
  }

  buildApi(options: Options) {
    return async () => {
      const { config, client } = await getConfig(
        {
          cwd: () => this.serverless.config.servicePath,
          env: {
            ...this.getEnv(options),
            NODE_ENV: process.env.NODE_ENV,
          },
        },
        true,
      );

      const spec = (await getRestApiBuilder(config)).getSpec();
      const clientCode = await generateClient(spec, client);
      const apiFile = path.resolve(
        this.serverless.config.servicePath,
        options.buildDir!,
        'Api.ts',
      );
      await new Promise((resolve, reject) => {
        writeFile(apiFile, clientCode, (err) =>
          err ? reject(err) : resolve(),
        );
      });
    };
  }

  async offline() {
    const options = this.getOptions();
    this.addFunctions(options);
    this.watchConfig(options);
  }

  async build() {
    const options = this.getOptions();
    this.addIncludes(options);
    this.addFunctions(options);
    if (options.createMediaBucket) {
      this.addMediaBucket(options);
    }
    await this.buildConfig(options);
    await this.buildApi(options)();

    // maybe also pre-bundle everything?!
  }
  async buildConfig(options: Options) {
    if (!options[TS_CONFIG_FILE]) {
      return;
    }

    const bundler = new Bundler(
      options[TS_CONFIG_FILE],
      this.bundlerOpts(options),
    );

    return bundler.bundle();
  }

  getEnv(options: Options) {
    return {
      DB: options.db,
      BASE_PATH: options.basePath,
      COTYPE_BASE_PATH: options.cotypeBasePath,
      SESSION_SECRET: options.sessionSecret,
      MEDIA_BUCKET: options.mediaBucketName,
      COTYPE_CONFIG_FILE: options.configFile,
    };
  }

  addFunctions(options: Options) {
    const handlersFile = 'node_modules/@cotype/serverless/lib/src/handlers';
    const { db, basePath } = options;

    this.service.update({
      functions: {
        migrate: {
          handler: `${handlersFile}.migrate`,
          timeout: 120,
          environment: {
            DB: db,
          },
        },
        cotype: {
          handler: `${handlersFile}.cotype`,
          timeout: 30,
          environment: this.getEnv(options),
          events: [
            {
              http: {
                path: basePath,
                method: 'ANY',
                cors: true,
              },
            },
            {
              http: {
                path: `${basePath}/{any+}`,
                method: 'ANY',
                cors: true,
              },
            },
          ],
        },
      },
    });
  }
  addMediaBucket({ mediaBucketName }: Options) {
    this.service.update({
      resources: {
        Resources: {
          MediaBucket: {
            Type: 'AWS::S3::Bucket',
            Properties: {
              BucketName: mediaBucketName,
              AccessControl: 'PublicRead',
              CorsConfiguration: {
                CorsRules: [
                  {
                    AllowedHeaders: ['*'],
                    AllowedMethods: ['GET'],
                    AllowedOrigins: ['*'],
                  },
                ],
              },
            },
          },
          LibraryDistBucketPolicy: {
            Type: 'AWS::S3::BucketPolicy',
            Properties: {
              Bucket: {
                Ref: 'MediaBucket',
              },
              PolicyDocument: {
                Statement: {
                  Action: ['s3:GetObject'],
                  Effect: 'Allow',
                  Resource: `arn:aws:s3:::${mediaBucketName}/*`,
                  Principal: '*',
                },
              },
            },
          },
        },
      },
    });
  }
  getDefaultOptions(): Options {
    return {
      basePath: '/cotype',
      buildDir: '.cotype',
      watch: AUTO_WATCH,
      createMediaBucket: true,
      configFile: this.tryConfigs(),
      mediaBucketName: `${this.service.getServiceName()}-${
        this.service.provider.stage
      }-media`,
    };
  }
  tryConfigs() {
    const configs = [
      path.join(this.serverless.config.servicePath, 'cotype.config.ts'),
      path.join(this.serverless.config.servicePath, 'cotype.config.js'),
      path.join(this.serverless.config.servicePath, 'cotype.config.json'),
    ];

    for (let i = 0, l = configs.length; i < l; i++) {
      const config = configs[i];
      if (existsSync(config)) {
        return config;
      }
    }

    return undefined;
  }
  withConfig(options: Options): Options {
    if (!options.configFile) {
      return options;
    }

    if (!options.configFile.match(/\.ts$/)) {
      return {
        ...options,
        configFile: path.relative(
          this.serverless.config.servicePath,
          options.configFile,
        ),
      };
    }

    const out = path.resolve(
      this.serverless.config.servicePath,
      options.buildDir!,
      'cotype.config.js',
    );

    return {
      ...options,
      [TS_CONFIG_FILE]: options.configFile,
      configFile: path.relative(this.serverless.config.servicePath, out),
    };
  }
}
