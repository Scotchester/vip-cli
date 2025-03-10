/**
 * External dependencies
 */
import gql from 'graphql-tag';

/**
 * Internal dependencies
 */
import API from '../../lib/api';
import { trackEventWithEnv } from '../../lib/tracker';
import * as exit from '../../lib/cli/exit';
import {
	AppMappedDomainsQuery,
	AppMappedDomainsQueryVariables,
} from './is-multisite-domain-mapped.generated';
import { App } from '../../graphqlTypes';

/**
 * Extracts the domain for site with ID 1 from an INSERT INTO `wp_site` SQL statement
 *
 * @param {Array} statements An array of SQL statements
 * @return {string} The domain
 */
export const getPrimaryDomainFromSQL = ( statements: string[][] ): string => {
	if ( ! statements.length ) {
		return '';
	}

	const SQL_WP_SITE_DOMAINS_REGEX = /\(1,'(.*?)'/s;
	const matches = statements[ 0 ]
		?.join( '' )
		.replace( /\s/g, '' )
		.match( SQL_WP_SITE_DOMAINS_REGEX );
	return matches ? matches[ 1 ] : '';
};

/**
 * Apply search-replacements to a domain
 *
 * @param {string}           domain        The domain to apply replacements to
 * @param {(string | Array)} searchReplace The search-replace pairs
 * @return {string} The processed domain
 */
export const maybeSearchReplacePrimaryDomain = function (
	domain: string,
	searchReplace?: string | string[]
): string {
	if ( searchReplace ) {
		const pairs = Array.isArray( searchReplace ) ? searchReplace : [ searchReplace ];
		const domainReplacements = pairs.map( pair => pair.split( ',' ) );
		const primaryDomainReplacement = domainReplacements.find( pair => pair[ 0 ] === domain );
		return primaryDomainReplacement?.[ 1 ] ?? domain;
	}
	return domain;
};

/**
 * Get the primary domain as it will be imported
 *
 * @param {Array}            statements    An array of SQL statements
 * @param {(string | Array)} searchReplace The search-replace pairs
 * @return {string} The replaced domain, or the domain as found in the SQL dump
 */
export const getPrimaryDomain = function (
	statements: string[][],
	searchReplace?: string | string[]
) {
	const domainFromSQL = getPrimaryDomainFromSQL( statements );
	return maybeSearchReplacePrimaryDomain( domainFromSQL, searchReplace );
};

/**
 * Gets the mapped domains and checks if the primary domain from the provided SQL dump is one of them
 *
 * @param {number} appId         The ID of the app in GOOP
 * @param {number} envId         The ID of the enviroment in GOOP
 * @param {string} primaryDomain The primary domain found in the provided SQL file
 * @return {boolean} Whether the primary domain is mapped
 */
export async function isMultisitePrimaryDomainMapped(
	appId: number,
	envId: number,
	primaryDomain: string
): Promise< boolean > {
	const track = trackEventWithEnv.bind( null, appId, envId );
	const api = await API();
	let res;
	try {
		res = await api.query< AppMappedDomainsQuery, AppMappedDomainsQueryVariables >( {
			query: gql`
				query AppMappedDomains($appId: Int, $envId: Int) {
					app(id: $appId) {
						id
						name
						environments(id: $envId) {
							uniqueLabel
							isMultisite
							domains {
								nodes {
									name
									isPrimary
								}
							}
						}
					}
				}
			`,
			variables: {
				appId,
				envId,
			},
		} );
	} catch ( GraphQlError ) {
		await track( 'import_sql_command_error', {
			error_type: 'GraphQL-MappedDomain-Check-failed',
			gql_err: GraphQlError,
		} );
		// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
		exit.withError( `StartImport call failed: ${ GraphQlError }` );
	}
	if ( ! Array.isArray( res.data.app?.environments ) ) {
		return false;
	}

	const environments = ( res.data.app as App ).environments;
	if ( ! environments?.length ) {
		return false;
	}

	const mappedDomains = environments[ 0 ]?.domains?.nodes?.map( domain => domain?.name ) ?? [];
	return mappedDomains.includes( primaryDomain );
}
