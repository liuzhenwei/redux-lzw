import { createStore, combineReducers, applyMiddleware, compose } from 'redux';
import { connect } from 'react-redux';
import thunk from 'redux-thunk';
import promise from 'redux-promise';
import Immutable, { Map, List } from 'immutable';

export function isFunction(obj) {
	return Object.prototype.toString.call(obj) === '[object Function]';
}
export function isPlainObject(obj) {
	return Object.prototype.toString.call(obj) === '[object Object]' && Object.getPrototypeOf(obj) == Object.prototype;
}

/**
 * 合并对象函数。默认是深度复制，但不合并数组内对象；首参数为false，为浅复制；首参数为merge，深度复制包含数组内的对象
 * @param  {object} target
 * @return {object}
 */
export function merge(target){
	function extend(target, source, deep) {
		for (var key in source) {
			if (deep && (isPlainObject(source[key]) || (Array.isArray(source[key]) && source[key].length > 0))) {
				if (isPlainObject(source[key]) && !isPlainObject(target[key])){
					target[key] = {};
				}
				if (Array.isArray(source[key]) && !Array.isArray(target[key])){
					target[key] = [];
				}
				extend(target[key], source[key], deep);
			}
			else if (source[key] !== undefined) target[key] = source[key];
		}
		if( Array.isArray(source) && deep && deep !== 'merge' ){
			target.length = source.length;
		}
	}

	var deep = true, args = Array.prototype.slice.call(arguments, 1);
	if (typeof target == 'boolean' || target == 'merge') {
		deep = target;
		target = args.shift();
	}
	args.forEach(function(arg){
		extend(target, arg, deep);
	});
	return target;
}

/**
 * 统一promise返回的数据，用Promise.all返回的数据是数组，需要合并后返回数据对象，单个promise则直接返回数据对象
 * @param  {array || object} source     promise返回的数据
 * @return {object}
 */
function promiseData(source){
	var data = {};
	if( Array.isArray(source) ){
		source.forEach(function(_data){
			data = merge(data, _data);
		});
	} else {
		data = source;
	}
	return data;
}

/**
 * 通过一个关键字，按特定格式转换为action的type
 * @param  {string}  key             关键字
 * @param  {boolean} returnErrorType 是否同时返回错误type名
 * @return {string || object}        如果returnErrorType为true，则同时返回success和error2个type名 
 */
export function getActionType(key, returnErrorType){
	var successType = key + '_action', errorType = successType + '_error';
	return returnErrorType ? {successType, errorType} : successType;
}

/**
 * 按格式返回action数据
 * @param  {string} type action的type
 * @param  {object} data action的数据
 * @return {object}
 */
function actionData(type, data){
	return {type, data};
}

/**
 * 创建一个异步action方法
 * @param  {string}     ACTION_TYPE    action中success的type
 * @param  {string}     ERROR_TYPE     action中error的type
 * @param  {function}   Service        用于异步处理action数据的方法
 * @return {function}
 */
export function asyncAction(ACTION_TYPE, ERROR_TYPE, service){
	return function(...param){
		return function(dispatch){
			var promises = isFunction(service) ? service(...param) : [new Promise(function(resolve){
				resolve({param});
			})];
			if( ! Array.isArray(promises) ){
				promises = [promises];
			}
			return Promise.all(promises)
				.then(function(pageData){
					return dispatch(actionData(ACTION_TYPE, promiseData(pageData)));
				})
				.catch(function(error){
					console.error(error);
					dispatch(actionData(ERROR_TYPE, error));
					return false;
				});
		};
	};
}

/**
 * 创建一个同步action方法
 * @param  {string}     ACTION_TYPE    action中type
 * @param  {string}     ERROR_TYPE     action中error的type（同步action中，该参数可忽略）
 * @param  {function}   Service        可选的，用于处理action数据的方法
 * @return {function}
 */
export function baseAction(ACTION_TYPE, ERROR_TYPE, service){
	return function(param){
		return isFunction(service) ? actionData(ACTION_TYPE, service(param)) : actionData(ACTION_TYPE, param);
	};
}


function getReducersConfig(config) {
	return Array.isArray(config) ? config : config.reducers;
}

/**
 * 通过一个reducer配置创建出action
 * @param  {array}   reducersConfig    reducer配置列表
 * @param  {string}  itemName          如果没有配置reducer对应的action信息，则通过这个名称创建一个默认的action配置
 * @param  {object}  service           用于处理action的方法集合
 * @return {object}                    action集合
 */
export function createAction(reducersConfig, itemName, service) {
	service = service || {};

	return reducersConfig.reduce(function(ret, reducerConfig) {
		// 如果reducer没有配置name属性，则用传入的itemName做reducer的名称
		var reducerName = reducerConfig.name || itemName;

		// 如果没有定义actions，则创建一个默认的actions
		var actionsConfig = isPlainObject(reducerConfig.actions) ? reducerConfig.actions : {[reducerName]: {}};

		var actions = Object.keys(actionsConfig).reduce(function(actionRet, actionName){
			var actionConfig = actionsConfig[actionName];
			var actionFunc = actionConfig.mode != 'base' ? asyncAction : baseAction;
			var {successType, errorType} = getActionType(actionName, true);

			if (typeof actionConfig.type == 'string') {
				successType = actionConfig.type;
				errorType = actionConfig.errorType || successType + '_error';
			}

			var actionService = isFunction(actionConfig.service) ? actionConfig.service : null;
			// 如果在action配置中没有定义service，则尝试使用外部的Service
			if (actionService == null){
				if (isFunction(service[successType])) {
					actionService = service[successType];
				} else if (isFunction(service[actionName])) {
					actionService = service[actionName];
				}
			}

			actionRet[successType] = actionFunc(successType, errorType, actionService);

			return actionRet;
		}, {});

		return merge(ret, actions);
	}, {});
}

/**
 * 通过一个配置列表创建出action，配置列表参见相关配置文件
 * @param  {array}   list      配置列表
 * @param  {object}  service   用于处理action的方法集合
 * @return {object}            action集合
 */
export function createActions(list, service){
	return Object.keys(list).reduce(function(ret, itemName){
		var reducersConfig = getReducersConfig(list[itemName]);

		if (Array.isArray(reducersConfig) ){
			return merge(ret, createAction(reducersConfig, itemName, service));
		}

		return ret;
	}, {});
}

/**
 * 将一个JSON对象转换为一个Immutable对象，但只转换object，不转换array
 * @param  {object}         json 要转换的JSON
 * @return {Immutable.Map}       转换后的Map对象
 */
export function toMap(json) {
	function setMap(source, target) {
		for (var key in source) {
			if (isPlainObject(source[key])) {
				target[key] = Map(setMap(source[key], {}));
			} else {
				target[key] = source[key];
			}
		}
		return target;
	}

	return Map(setMap(json, {}));
}

/**
 * 通过一个reducer配置，创建一个reducer函数
 * @param  {array}    reducersConfig   reducers配置信息
 * @param  {string}   itemName         如果没有配置reducer对应的action信息，则通过这个名称创建一个默认的action配置
 * @return {function}                  reducer函数
 */
export function createReducer(reducersConfig, itemName) {
	return reducersConfig.reduce(function(ret, reducerConfig) {
		// 如果reducer没有配置name属性，则用传入的itemName做reducer的名称
		var reducerName = reducerConfig.name || itemName;

		// 如果没有定义actions，则创建一个默认的actions
		var actionsConfig = isPlainObject(reducerConfig.actions) ? reducerConfig.actions : {[reducerName]: {}};

		// 如果reducer配置中定义了immutable state的方法，则用定义的方法，否则使用默认的，默认的只会将object转成map，忽略array
		var initialState = isFunction(reducerConfig.immutableState) ? reducerConfig.immutableState(reducerConfig.initialState) : toMap(reducerConfig.initialState);

		ret[reducerName] = function(state = initialState, result) {
			for (var actionName in actionsConfig) {
				var action = actionsConfig[actionName];
				
				// 获取action的type从action的name
				var {successType, errorType} = getActionType(actionName, true);

				if (result.type == action.type || result.type == successType) {
					// action结果的type==预先定义的type或==从name获取的type
					if (isFunction(action.merge)) {
						// 如果定义的merge函数，则使用自定义的merge函数，传入参数都不是immutable对象，是普通object
						return action.merge(state.toJSON(), result.data, reducerConfig.initialState);
					} else if (typeof action.merge == 'string') {
						// 如果定义了merge的方法名称（见Immutable.js文档），则直接使用定义的方法
						return state[action.merge](result.data);
					} else {
						// 默认merge方法
						return state.mergeDeepWith((prev, next, key) => {
							if (next == undefined) {
								return prev;
							}
							if (List.isList(next)) {
								return next.toJSON();
							}
							return next;
						}, result.data);
					}
				} else if (result.type == errorType) {
					// action结果的type==从name获取的出错type
					return state.merge({errorInfo: result.data});
				}
			}
			return state;
		};

		return ret;
	}, {});
}

/**
 * 通过一个配置列表创建出reducers列表，配置列表参见相关配置文件
 * @param  {array}    list           配置列表
 * @return {object}                  reducer集合
 */
export function createReducers(list){
	return Object.keys(list).reduce(function(ret, itemName){
		var reducersConfig = getReducersConfig(list[itemName]);

		if (Array.isArray(reducersConfig) ){
			return merge(ret, createReducer(reducersConfig, itemName));
		}

		return ret;
	}, {});
}

/**
 * 传入一个reducer集合，创建一个store
 * @param  {object} reducers reducer集合
 * @return {store}
 */
export function reducersToStore(reducers){
	var Reducers = combineReducers(reducers);
	var initialState = typeof(window) != 'undefined' ? window.__INITIAL_STATE__ || {} : {};

	return createStore(Reducers, initialState, compose(
		applyMiddleware(thunk, promise),
		typeof(window) != 'undefined' && window.devToolsExtension ? window.devToolsExtension() : f => f
	));
}

/**
 * 通过一个配置列表创建出store，配置列表参见相关配置文件
 * @param  {array}    list           配置列表
 * @param  {object}   otherReducers  可选的，额外附加的reducer函数集合
 * @return {object}                  store集合
 */
export function createStores(list, otherReducers){
	return Object.keys(list).reduce(function(ret, itemName){
		var reducersConfig = getReducersConfig(list[itemName]);

		if (Array.isArray(reducersConfig) && list[itemName].store === false ){
			var reducers = merge(createReducer(reducersConfig, itemName), otherReducers || {});
			ret[itemName] = reducersToStore(reducers);
			return ret;
		}

		return ret;
	}, {});
}

/**
 * 连接redux和react组件，使react组件可以响应redux中的数据
 * @param  {react}   Component  react组件
 * @param  {string}  dataName   可选的，绑定的数据名称
 * @param  {object}  Actions    要链接的action
 * @return {react}              绑定redux后的react组件
 */
export function connectStateData(Component, dataName, Actions){
	dataName = dataName || 'componentData';
	function mapStateToProps(data){
		return {[dataName]: data};
	}
	if( isPlainObject(Actions) ){
		return connect(mapStateToProps, Actions)(Component);
	} else {
		return connect(mapStateToProps)(Component);
	}
}
