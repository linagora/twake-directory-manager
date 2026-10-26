import { expect } from 'chai';
import { POLICIES_KEY, routeOf } from '../../src/console/route';

describe('the route the address names', () => {
  it('should read the overview, a list, a card, the organizations and the policies', () => {
    expect(routeOf('')).to.deep.equal({ view: 'dashboard' });
    expect(routeOf('#/')).to.deep.equal({ view: 'dashboard' });
    expect(routeOf('#/users')).to.deep.equal({
      view: 'entity',
      entity: 'users',
      id: undefined,
    });
    expect(routeOf('#/users/alice')).to.deep.equal({
      view: 'entity',
      entity: 'users',
      id: 'alice',
    });
    expect(
      routeOf('#/organizations/ou%3DSales%2Cou%3Dorganization%2Cdc%3Dexample')
    ).to.deep.equal({
      view: 'organizations',
      id: 'ou=Sales,ou=organization,dc=example',
    });
    expect(routeOf(`#/${POLICIES_KEY}`)).to.deep.equal({ view: 'policies' });
  });

  it('should take a segment that does not decode as it stands', () => {
    // `#/users/50%` threw out of decodeURIComponent, and the console stayed
    // on "Loading…" for good.
    expect(routeOf('#/users/50%')).to.deep.equal({
      view: 'entity',
      entity: 'users',
      id: '50%',
    });
  });
});
