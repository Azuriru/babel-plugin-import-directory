
/*
    The following file is a modified version of bluepropane/babel-plugin-import-dir
    babel plugin with some fixes (namely - https://github.com/bluepropane/babel-plugin-import-dir/issues/8).
    Seems like this repository is abandoned, so I had to copy and modify it directly.
*/

const glob = require('glob');
const path = require('path')

const MATCH_MODULE_FILES = /\.(js|jsx|ts)$/g;

class ImportDeclarationHandler {
    constructor(path, state, t) {
        this.setContext(path, state, t);
        this.output = [];
    }
    getModulesFromPattern(pattern, cwd) {
        const dirs = glob.sync(pattern, { mark: true, cwd });
        return dirs
            .filter(mod => {
                let result = MATCH_MODULE_FILES.exec(mod) || mod.endsWith('/')
                MATCH_MODULE_FILES.lastIndex = 0
                return result
            })
            .map(mod => {
                if (mod.endsWith('/')) {
                    mod = mod.slice(0, -1);
                } else {
                    mod = mod.replace(MATCH_MODULE_FILES, '');
                }
                return mod;
            });
    };


    modulePathToInfo(modulePath) {
        return {
            path: modulePath,
            name: modulePath.split('/').slice(-1)[0],
        };
    };

    setContext(contextPath, state, t) {
        const node = contextPath.node;
        const context = { path: contextPath, state, t, node };
        context.cwd = path.dirname(state.file.opts.filename);
        context.targetPattern = node.source.value;
        const moduleInfo = this
            .getModulesFromPattern(context.targetPattern, context.cwd)
            .map(path => this.modulePathToInfo(path));

        context.modulePaths = moduleInfo.reduce((accum, { path, name }) => {
            accum[name] = path;
            return accum;
        }, {});

        context.importedModuleIdentifiers = moduleInfo.reduce((accum, { name }) => {
            accum[name] = contextPath.scope.generateUidIdentifier(name);
            return accum;
        }, {});
        this.context = context;
    };

    transformSpecifier(node) {
        let output;
        const { importedModuleIdentifiers, modulePaths, t } = this.context;
        if (this.hasDefaultImportSpecifier) {
            output = t.variableDeclaration('const', [
                t.variableDeclarator(
                    t.identifier(node.local.name),
                    importedModuleIdentifiers[node.local.name]
                ),
            ]);
        } else {
            output = t.importDeclaration(
                [t.importDefaultSpecifier(t.identifier(node.local.name))],
                t.stringLiteral(modulePaths[node.local.name])
            );
        }

        this.output.push(output);
    };

    transformDefaultSpecifier() {
        const { importedModuleIdentifiers, modulePaths, t } = this.context;

        for (let moduleName in modulePaths) {
            this.output.push(
                t.importDeclaration(
                    [t.importDefaultSpecifier(importedModuleIdentifiers[moduleName])],
                    t.stringLiteral(modulePaths[moduleName])
                )
            );
        }
    };

    generateDefaultExportObject() {
        const { path, importedModuleIdentifiers, t } = this.context;
        const defaultExportObject = t.variableDeclaration('const', [
            t.variableDeclarator(
                t.identifier(path.node.specifiers[0].local.name),
                t.arrayExpression(
                    Object.entries(importedModuleIdentifiers).map(
                        ([, importedModuleId]) => {
                            return importedModuleId
                        })
                )
            )
        ]);
        return defaultExportObject;
    };

    run() {
        const { t, node } = this.context;
        node.specifiers.map(specifierNode => {
            if (t.isImportDefaultSpecifier(specifierNode)) {
                this.hasDefaultImportSpecifier = true;
                this.transformDefaultSpecifier();
            } else if (t.isImportSpecifier(specifierNode)) {
                this.transformSpecifier(specifierNode);
            }
        });
        if (this.hasDefaultImportSpecifier) {
            this.output.push(this.generateDefaultExportObject());
        }
    }
}

function getFinalPath(path) {
    return path
        .split('/')
        .filter(subPath => subPath !== '')
        .slice(-1);
}

module.exports = ({ types: t }) => {
    return {
        visitor: {
            ImportDeclaration(path, state) {
                const node = path.node;
                if ((getFinalPath(node.source.value)[0] || []).includes('*')) {
                    const handler = new ImportDeclarationHandler(path, state, t);
                    handler.run();
                    path.replaceWithMultiple(handler.output);
                }
            },
        },
    };
};