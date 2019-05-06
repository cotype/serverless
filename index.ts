import Serverless from 'serverless';
import Plugin from 'serverless/classes/Plugin';
import Service from 'serverless/classes/Service';
import * as path from 'path';
import { existsSync } from 'fs';
import Bundler from 'parcel-bundler';

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
  options: Options;
  commands: {
    [command: string]: {};
  };
  constructor(serverless: Serverless, options: Serverless.Options) {
    this.serverless = serverless;
    this.service = serverless.service;
    this.options = this.withConfig({
      ...this.getDefaultOptions(),
      ...(serverless.service.custom || {})['cotype'],
      ...options,
    });

    this.addIncludes();
    this.addFunctions();
    if (this.options.createMediaBucket) {
      this.addMediaBucket();
    }

    this.hooks = {
      'before:offline:start:init': this.watchConfig.bind(this),
      'before:run:run': this.build.bind(this),
      'before:invoke:local:invoke': this.build.bind(this),
      'before:package:createDeploymentArtifacts': this.build.bind(this),
      'before:deploy:function:packageFunction': this.build.bind(this),
    };
  }
  addIncludes() {
    this.service.package = this.service.package || {};
    this.service.package.include = this.service.package.include || [];
    this.service.package.include.push(
      path.relative(
        this.serverless.config.servicePath,
        path.resolve(
          this.serverless.config.servicePath,
          this.options.buildDir!,
          '**',
        ),
      ),
    );
    this.service.package.include.push(
      'node_modules/@cotype/serverless/lib/src',
    );
  }
  bundlerOpts(): ParcelOptionsWithAutoInstall {
    return {
      watch: false,
      outDir: path.dirname(this.options.configFile!),
      outFile: path.basename(this.options.configFile!),
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
  async watchConfig() {
    if (
      !this.options[TS_CONFIG_FILE] ||
      !this.options.watch ||
      this.options.watch !== AUTO_WATCH
    ) {
      return;
    }

    const bundler = new Bundler(this.options[TS_CONFIG_FILE], {
      ...this.bundlerOpts(),
      watch: true,
    });

    return bundler.bundle();
  }
  async build() {
    this.serverless.cli.log('Cotype: Building handlers');
    await this.buildConfig();

    // const handlersFile = path.join(
    //   this.serverless.config.servicePath,
    //   this.options.buildDir!,
    //   'handlers.js',
    // );
    // await new Bundler(path.resolve(__dirname, 'src/handlers.js'), {
    //   ...this.bundlerOpts(),
    //   outDir: path.dirname(handlersFile),
    //   outFile: path.basename(handlersFile),
    // }).bundle();

    // const relativeHandlersFile = path.join(this.options.buildDir!, 'handlers');

    // this.service.update({
    //   functions: {
    //     migrate: {
    //       handler: `${relativeHandlersFile}.migrate`,
    //     },
    //     cotype: {
    //       handler: `${relativeHandlersFile}.cotype`,
    //     },
    //   },
    // });

    this.serverless.cli.log('Cotype: Done');
  }
  async buildConfig() {
    if (!this.options[TS_CONFIG_FILE]) {
      return;
    }

    const bundler = new Bundler(
      this.options[TS_CONFIG_FILE],
      this.bundlerOpts(),
    );

    return bundler.bundle();
  }
  addFunctions() {
    const handlersFile = 'node_modules/@cotype/serverless/lib/src/handlers';

    this.service.update({
      functions: {
        migrate: {
          handler: `${handlersFile}.migrate`,
          timeout: 120,
          environment: {
            DB: this.options.db,
          },
        },
        cotype: {
          handler: `${handlersFile}.cotype`,
          timeout: 30,
          environment: {
            DB: this.options.db,
            BASE_PATH: this.options.basePath,
            COTYPE_BASE_PATH: this.options.cotypeBasePath,
            SESSION_SECRET: this.options.sessionSecret,
            MEDIA_BUCKET: this.options.mediaBucketName,
            COTYPE_CONFIG_FILE: this.options.configFile,
          },
          events: [
            {
              http: {
                path: this.options.basePath,
                method: 'ANY',
                cors: true,
              },
            },
            {
              http: {
                path: `${this.options.basePath}/{any+}`,
                method: 'ANY',
                cors: true,
              },
            },
          ],
        },
      },
    });
  }
  addMediaBucket() {
    this.service.update({
      resources: {
        Resources: {
          MediaBucket: {
            Type: 'AWS::S3::Bucket',
            Properties: {
              BucketName: this.options.mediaBucketName,
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
                  Resource: `arn:aws:s3:::${this.options.mediaBucketName}/*`,
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
