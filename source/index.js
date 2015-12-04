import path   from 'path'
import fs     from 'fs'

import require_hacker from 'require-hacker'
import Log            from './tools/log'

import { exists, clone, convert_from_camel_case, starts_with, ends_with } from './helpers'
import { default_webpack_assets, normalize_options, alias_hook, normalize_asset_path, webpack_path } from './common'

// using ES6 template strings
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/template_strings
export default class webpack_isomorphic_tools
{
	// require() hooks for assets
	hooks = []

	// used to keep track of cached assets and flush their caches on .refresh() call
	cached_assets = []

	constructor(options)
	{
		// take the passed in options
		this.options = convert_from_camel_case(clone(options))

		// add missing fields, etc
		normalize_options(this.options)

		// if Webpack aliases are supplied, enable aliasing
		if (this.options.alias)
		{
			this.enable_aliasing()
		}

		// set require-hacker debug mode if run in debug mode
		if (this.options.debug)
		{
			require_hacker.log.options.debug = true
		}

		// logging
		this.log = new Log('webpack-isomorphic-tools', { debug: this.options.debug })

		this.log.debug('instantiated webpack-isomorphic-tools with options', this.options)
	}

	// sets development mode flag to whatever was passed (or true if nothing was passed)
	// (development mode allows asset hot reloading when used with webpack-dev-server)
	development(flag)
	{
		// set development mode flag
		this.options.development = exists(flag) ? flag : true

		if (this.options.development)
		{
			this.log.debug('entering development mode')
		}
		else
		{
			this.log.debug('entering production mode')
		}

		// allows method chaining
		return this
	}

	// returns a mapping to read file paths for all the user specified asset types
	// along with a couple of predefined ones: javascripts and styles
	assets()
	{
		// when in development mode
		if (this.options.development)
		{
			// webpack and node.js start in parallel
			// so webpack-assets.json might not exist on the very first run
			// if a developer chose not to use the .server() method with a callback
			// (or if a developer chose not to wait for a Promise returned by the .server() method)
			if (!fs.existsSync(this.webpack_assets_path))
			{
				this.log.error(`"${this.webpack_assets_path}" not found. Most likely it hasn't yet been generated by Webpack. Using an empty stub instead.`)
				return default_webpack_assets()
			}
		}

		return require(this.webpack_assets_path)
	}

	// clear the require.cache (only used in developer mode with webpack-dev-server)
	refresh()
	{
		// ensure this is development mode
		if (!this.options.development)
		{
			throw new Error('.refresh() called in production mode. Did you forget to call .development() method on your webpack-isomorphic-tools server instance?')
		}

		this.log.debug('flushing require() caches')

		// uncache webpack-assets.json file
		// this.log.debug(' flushing require() cache for webpack assets json file')
		// this.log.debug(` (was cached: ${typeof(require.cache[this.webpack_assets_path]) !== 'undefined'})`)
		delete require.cache[this.webpack_assets_path]

		// uncache cached assets
		for (let path of this.cached_assets)
		{
			this.log.debug(` flushing require() cache for ${path}`)
			delete require.cache[path]
		}

		// no assets are cached now
		this.cached_assets = []
	}

	// Makes `webpack-isomorphic-tools` aware of Webpack aliasing feature.
	// https://webpack.github.io/docs/resolving.html#aliasing
	// The `aliases` parameter corresponds to `resolve.alias` 
	// in your Webpack configuration. 
	// If this method is used it must be called before the `.server()` method.
	enable_aliasing()
	{
		// mount require() hook
		this.alias_hook = require_hacker.global_hook('aliasing', (path, module) =>
		{
			return alias_hook(path, module, this.options.project_path, this.options.alias, this.log)
		})

		// allows method chaining
		return this
	}

	// Initializes server-side instance of `webpack-isomorphic-tools` 
	// with the base path for your project, then calls `.register()`,
	// and after that calls .wait_for_assets(callback).
	//
	// The `project_path` parameter must be identical 
	// to the `context` parameter of your Webpack configuration 
	// and is needed to locate `webpack-assets.json` 
	//  which is output by Webpack process. 
	//
	// sets up "project_path" option
	// (this option is required on the server to locate webpack-assets.json)
	server(project_path, callback)
	{
		// project base path, required to locate webpack-assets.json
		this.options.project_path = project_path

		// resolve webpack-assets.json file path
		this.webpack_assets_path = path.resolve(this.options.project_path, this.options.webpack_assets_file_path)

		// register require() hooks
		this.register()

		// when ready: 

		// if callback is given, call it back
		if (callback)
		{
			// call back when ready
			return this.wait_for_assets(callback)
		}
		// otherwise resolve a Promise
		else
		{
			// no callback given, return a Promise
			return new Promise((resolve, reject) => this.wait_for_assets(resolve))
		}
	}

	// Registers Node.js require() hooks for the assets
	//
	// This is what makes the `requre()` magic work on server. 
	// These `require()` hooks must be set before you `require()` 
	// any of your assets 
	// (e.g. before you `require()` any React components 
	// `require()`ing your assets).
	//
	// read this article if you don't know what a "require hook" is
	// http://bahmutov.calepin.co/hooking-into-node-loader-for-fun-and-profit.html
	register()
	{
		this.log.debug('registering require() hooks for assets')

		// // a helper array for extension matching
		// const extensions = []
		//
		// // for each user specified asset type,
		// // for each file extension,
		// // create an entry in the extension matching array
		// for (let asset_type of Object.keys(this.options.assets))
		// {
		// 	const description = this.options.assets[asset_type]
		//	
		// 	for (let extension of description.extensions)
		// 	{
		// 		extensions.push([`.${extension}`, description])
		// 	}
		// }
		//
		// // registers a global require() hook which runs 
		// // before the default Node.js require() logic
		// this.asset_hook = require_hacker.global_hook('webpack-asset', (path, module) =>
		// {
		// 	// for each asset file extension
		// 	for (let extension of extensions)
		// 	{
		// 		// if the require()d path has this file extension
		// 		if (ends_with(path, extension[0]))
		// 		{
		// 			// then require() it using webpack-assets.json
		// 			return this.require(require_hacker.resolve(path, module), extension[1])
		// 		}
		// 	}
		// })

		// for each user specified asset type,
		// register a require() hook for each file extension of this asset type
		for (let asset_type of Object.keys(this.options.assets))
		{
			const description = this.options.assets[asset_type]
			
			for (let extension of description.extensions)
			{
				this.register_extension(extension, description)
			}
		}
				
		// allows method chaining
		return this
	}

	// registers a require hook for a particular file extension
	register_extension(extension, description)
	{
		this.log.debug(` registering a require() hook for *.${extension}`)
	
		// place the require() hook for this extension
		if (extension === 'json')
		{
			this.hooks.push(require_hacker.hook(extension, path =>
			{
				// special case for require('webpack-assets.json') and 'json' asset extension
				if (path === this.webpack_assets_path)
				{
					return
				}

				return this.require(path, description)
			}))
		}
		else
		{
			this.hooks.push(require_hacker.hook(extension, path => this.require(path, description)))
		}
	}

	// require()s an asset by a path
	require(global_asset_path, description)
	{
		this.log.debug(`require() called for ${global_asset_path}`)

		// sanity check
		/* istanbul ignore if */
		if (!this.options.project_path)
		{
			throw new Error(`You forgot to call the .server() method passing it your project's base path`)
		}

		// convert global asset path to local-to-the-project asset path
		const asset_path = normalize_asset_path(global_asset_path, this.options.project_path)

		// if this filename is in the user specified exceptions list
		// (or is not in the user explicitly specified inclusion list)
		// then fall back to the normal require() behaviour
		if (!this.includes(asset_path, description) || this.excludes(asset_path, description))
		{
			this.log.debug(` skipping require call for ${asset_path}`)
			return
		}

		// track cached assets (only in development mode)
		if (this.options.development)
		{
			// mark this asset as cached
			this.cached_assets.push(global_asset_path)
		}
		
		// return CommonJS module source for this asset
		return require_hacker.to_javascript_module_source(this.asset_source(webpack_path(asset_path)))
	}

	// returns asset source by path (looks it up in webpack-assets.json)
	asset_source(asset_path)
	{
		this.log.debug(` requiring ${asset_path}`)

		// sanity check
		/* istanbul ignore if */
		if (!asset_path)
		{
			return undefined
		}

		// get real file path list
		var assets = this.assets().assets
		
		// find this asset in the real file path list
		const asset = assets[asset_path]
		
		// if the asset was found in the list - return it
		if (exists(asset))
		{
			return asset
		}

		// serve a not-found asset maybe
		this.log.error(`asset not found: ${asset_path}`)
		return undefined
	}

	// unregisters require() hooks
	undo()
	{
		// for each user specified asset type,
		// unregister a require() hook for each file extension of this asset type
		for (let hook of this.hooks)
		{
			hook.unmount()
		}

		// this.asset_hook.unmount()

		// unmount the aliasing hook (if mounted)
		if (this.alias_hook)
		{
			this.alias_hook.unmount()
		}
	}

	// Checks if the required path should be excluded from the custom require() hook
	excludes(path, options)
	{
		// if "exclude" parameter isn't specified, then exclude nothing
		if (!exists(options.exclude))
		{
			return false
		}

		// for each exclusion case
		for (let exclude of options.exclude)
		{
			// supports regular expressions
			if (exclude instanceof RegExp)
			{
				if (exclude.test(path))
				{
					return true
				}
			}
			// check for a compex logic match
			else if (typeof exclude === 'function')
			{
				if (exclude(path))
				{
					return true
				}
			}
			// otherwise check for a simple textual match
			else
			{
				if (exclude === path)
				{
					return true
				}
			}
		}

		// no matches found.
		// returns false so that it isn't undefined (for testing purpose)
		return false
	}

	// Checks if the required path should be included in the custom require() hook
	includes(path, options)
	{
		// if "include" parameter isn't specified, then include everything
		if (!exists(options.include))
		{
			return true
		}

		// for each inclusion case
		for (let include of options.include)
		{
			// supports regular expressions
			if (include instanceof RegExp)
			{
				if (include.test(path))
				{
					return true
				}
			}
			// check for a compex logic match
			else if (typeof include === 'function')
			{
				if (include(path))
				{
					return true
				}
			}
			// otherwise check for a simple textual match
			else
			{
				if (include === path)
				{
					return true
				}
			}
		}

		// no matches found.
		// returns false so that it isn't undefined (for testing purpose)
		return false
	}

	// Waits for webpack-assets.json to be created after Webpack build process finishes
	//
	// The callback is called when `webpack-assets.json` has been found 
	// (it's needed for development because `webpack-dev-server` 
	//  and your application server are usually run in parallel).
	//
	wait_for_assets(done)
	{
		// condition check interval
		const interval = 300 // in milliseconds

		// selfie
		const tools = this

		// waits for condition to be met, then proceeds
		function wait_for(condition, proceed)
		{
			function check()
			{
				// if the condition is met, then proceed
				if (condition())
				{
					return proceed()
				}

				tools.log.debug(`(${tools.webpack_assets_path} not found)`)
				tools.log.info('(waiting for the first Webpack build to finish)')

				setTimeout(check, interval)
			}

			check()
		}

		// wait for webpack-assets.json to be written to disk by Webpack
		wait_for(() => fs.existsSync(this.webpack_assets_path), done)

		// allows method chaining
		return this
	}
}